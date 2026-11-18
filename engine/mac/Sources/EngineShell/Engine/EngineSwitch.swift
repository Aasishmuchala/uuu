import Foundation

/// Whether this app may start and stop the engine. `unavailable` carries the one sentence the interface
/// shows: W8 (a development build) or W10 (the engine it was built for is gone or unsafe), nothing else.
public enum SwitchState: Equatable { case ready, unavailable(String) }

/// The native side's only way to the engine's switch (PLAN-MAC-2 N4b). One implementation today,
/// `LocalEngineSwitch`; a client that cannot start or stop the engine is the `unavailable` state.
public protocol EngineSwitch: AnyObject {
    var state: SwitchState { get }
    func run(_ verb: EngineVerb) async -> (exit: Int32, lines: [String])
}

/// The switch of the engine compiled into this build: EngineCommand.refusal decides, EngineCommand.run runs.
public final class LocalEngineSwitch: EngineSwitch {
    private let flavor: String
    private let compiledRoot: String
    private let allowTemp: Bool

    public convenience init(flavor: String, compiledRoot: String) {
        self.init(flavor: flavor, compiledRoot: compiledRoot, allowTemp: false)
    }

    /// `allowTemp` is for the checks, which build their stand-in roots in a temp folder (as
    /// EngineRoot.check(path:allowTemp:)). The app never passes it.
    public init(flavor: String, compiledRoot: String, allowTemp: Bool) {
        self.flavor = flavor
        self.compiledRoot = compiledRoot
        self.allowTemp = allowTemp
    }

    private var root: URL { URL(fileURLWithPath: compiledRoot, isDirectory: true) }

    /// Read afresh each time: a root that was good at launch may have been moved or made unsafe since.
    /// Start is the verb asked, so a development build is always W8, whatever root it holds.
    public var state: SwitchState {
        if let sentence = EngineCommand.refusal(.start, flavor: flavor, compiledRoot: compiledRoot, root: root,
                                                allowTemp: allowTemp) {
            return .unavailable(sentence)
        }
        return .ready
    }

    public func run(_ verb: EngineVerb) async -> (exit: Int32, lines: [String]) {
        if case .unavailable(let sentence) = state { return (-1, [sentence]) }
        return await EngineCommand.run(verb, root: root)
    }
}
