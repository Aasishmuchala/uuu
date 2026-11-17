import Foundation

public enum EngineVerb { case start, stop, status }

public enum EngineCommand {
    public static func run(_ verb: EngineVerb, root: URL) async -> (exit: Int32, lines: [String]) {
        fatalError("M3")
    }
}
