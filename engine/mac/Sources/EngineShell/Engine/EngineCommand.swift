import Foundation

public enum EngineVerb: CaseIterable, Sendable {
    case start, stop, status

    // The only words that ever reach the engine script's argument list.
    var word: String {
        switch self {
        case .start: return "start"
        case .stop: return "stop"
        case .status: return "status"
        }
    }
}

// How long each verb may run before its one process is sent SIGTERM (4.4).
public struct EngineLimits: Sendable {
    public var start: TimeInterval
    public var stop: TimeInterval
    public var status: TimeInterval

    public init(start: TimeInterval, stop: TimeInterval, status: TimeInterval) {
        self.start = start; self.stop = stop; self.status = status
    }

    public static let standard = EngineLimits(start: 600, stop: 180, status: 60)

    public func seconds(for verb: EngineVerb) -> TimeInterval {
        switch verb {
        case .start: return start
        case .stop: return stop
        case .status: return status
        }
    }
}

// S5: runs exactly `/bin/bash <root>/engine/bin/engine <start|stop|status>`, in <root>, with stdin from
// /dev/null and the seven-key environment of EngineEnvironment, one run at a time. Output is kept as at
// most 200 lines (the last ones) of at most 500 characters, control and direction characters removed.
public enum EngineCommand {
    public static let maxLines = 200
    public static let maxLineLength = 500

    public static func run(_ verb: EngineVerb, root: URL) async -> (exit: Int32, lines: [String]) {
        await run(verb, root: root, limits: .standard)
    }

    // The checks shorten the limits; the app uses `run(_:root:)`.
    public static func run(_ verb: EngineVerb, root: URL, limits: EngineLimits) async -> (exit: Int32, lines: [String]) {
        if let refusal = refusal(verb, flavor: BuildConstants.flavor, compiledRoot: BuildConstants.engineRoot,
                                 root: root, allowTemp: false) {
            return (-1, [refusal])
        }
        guard claim() else { return (-1, [EngineWords.busy]) }
        return await withCheckedContinuation { done in
            DispatchQueue.global(qos: .userInitiated).async {
                let result = runNow(verb, root: root, limit: limits.seconds(for: verb))
                release()
                done.resume(returning: result)
            }
        }
    }

    // Whether this build may run `verb` on `root`; nil when it may, else the one sentence that says why not.
    // A development build never starts or stops anything, and runs `status` only on a stand-in under a temp
    // folder (the checks'). A release build runs only the root compiled into it, and only while that root
    // still passes EngineRoot.check. `allowTemp` lets the checks try the release rule on a temp root.
    public static func refusal(_ verb: EngineVerb, flavor: String, compiledRoot: String, root: URL,
                               allowTemp: Bool) -> String? {
        guard let asked = EngineRoot.realPath(root.path) else {
            return flavor == "release" ? EngineWords.badRoot : EngineWords.devBuild
        }
        if flavor == "release" {
            guard case .success(let built) = EngineRoot.check(path: compiledRoot, allowTemp: allowTemp),
                  built.path == asked else { return EngineWords.badRoot }
            return nil
        }
        guard verb == .status,
              EngineRoot.isUnderTemp(asked),
              case .success = EngineRoot.check(path: root.path, allowTemp: true) else { return EngineWords.devBuild }
        return nil
    }

    // ---- one at a time ---------------------------------------------------------------------------------

    private static let lock = NSLock()
    private static var running = false

    private static func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if running { return false }
        running = true
        return true
    }

    private static func release() {
        lock.lock(); running = false; lock.unlock()
    }

    // ---- the run ---------------------------------------------------------------------------------------

    private static func runNow(_ verb: EngineVerb, root: URL, limit: TimeInterval) -> (exit: Int32, lines: [String]) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [EngineRoot.script(in: root).path, verb.word]
        proc.currentDirectoryURL = root
        proc.environment = EngineEnvironment.forThisUser()
        guard let null = FileHandle(forReadingAtPath: "/dev/null") else { return (-1, []) }
        proc.standardInput = null
        let pipe = Pipe()
        proc.standardOutput = pipe
        proc.standardError = pipe

        let sink = OutputSink()
        let reader = pipe.fileHandleForReading
        reader.readabilityHandler = { h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; sink.finish() } else { sink.append(d) }
        }

        let exited = DispatchSemaphore(value: 0)
        let state = NSLock()
        var over = false
        proc.terminationHandler = { _ in
            state.lock(); over = true; state.unlock()
            exited.signal()
        }
        do {
            try proc.run()
        } catch {
            reader.readabilityHandler = nil
            try? null.close()
            return (-1, [])
        }
        let pid = proc.processIdentifier
        try? null.close()

        // The time limit: SIGTERM to this one PID, never to a group and never by name; what it started is
        // left to the engine's own stop.
        if exited.wait(timeout: .now() + limit) == .timedOut {
            state.lock()
            if !over { kill(pid, SIGTERM) }
            state.unlock()
            exited.wait()
        }

        // A child the script left running may hold the pipe open: wait a moment for the end, then stop reading.
        _ = sink.ended.wait(timeout: .now() + 1)
        reader.readabilityHandler = nil
        try? reader.close()

        let code = proc.terminationReason == .uncaughtSignal ? 128 + proc.terminationStatus : proc.terminationStatus
        return (code, lines(from: sink.take()))
    }

    // The kept lines: the last 200, each cut to 500 characters, with control and direction characters removed.
    public static func lines(from data: Data) -> [String] {
        var text = String(decoding: data, as: UTF8.self)
        if text.hasSuffix("\n") { text.removeLast() }
        if text.isEmpty { return [] }
        let all = text.split(separator: "\n", omittingEmptySubsequences: false)
        return all.suffix(maxLines).map { clean(String($0)) }
    }

    public static func clean(_ line: String) -> String {
        var out = String.UnicodeScalarView()
        for s in line.unicodeScalars where !isHidden(s) { out.append(s) }
        return String(String(out).prefix(maxLineLength))
    }

    static func isHidden(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x00...0x1F, 0x7F...0x9F: return true                       // control characters
        case 0x200E, 0x200F, 0x202A...0x202E, 0x2066...0x2069: return true // direction marks and overrides
        default: return false
        }
    }
}

// What the script printed, read on a background queue. Keeps only the last 512 KB, enough for 200 lines of
// 500 characters.
private final class OutputSink {
    private let lock = NSLock()
    private var data = Data()
    private var trimmed = false
    let ended = DispatchSemaphore(value: 0)
    private static let keep = 512 * 1024

    func append(_ d: Data) {
        lock.lock(); defer { lock.unlock() }
        data.append(d)
        if data.count > 2 * OutputSink.keep {
            data = Data(data.suffix(OutputSink.keep))
            trimmed = true
        }
    }

    func finish() { ended.signal() }

    func take() -> Data {
        lock.lock(); defer { lock.unlock() }
        guard trimmed, let nl = data.firstIndex(of: 0x0A) else { return data }
        return Data(data[data.index(after: nl)...])   // the first line was cut by the trim
    }
}
