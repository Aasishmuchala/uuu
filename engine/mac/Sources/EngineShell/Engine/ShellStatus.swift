import Foundation

public enum PartState { case on, off, notInstalled, unknown }

public struct ShellStatus: Equatable {
    public var needsYou: Int
    public var running: Int
    public var board: PartState
    public var books: PartState
    public var gate: PartState

    public init(needsYou: Int, running: Int, board: PartState, books: PartState, gate: PartState) {
        self.needsYou = needsYou; self.running = running
        self.board = board; self.books = books; self.gate = gate
    }

    public static let maxBody = 1024 * 1024
    public static let maxCount = 100_000

    // 4.5: only counts.needsYou, counts.running (integers 0 to 100,000) and engine.board|books|gate are read;
    // every other key is ignored and not kept. Anything else about the body: nil.
    public static func parse(_ data: Data) -> ShellStatus? {
        guard !data.isEmpty, data.count <= maxBody,
              let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let counts = top["counts"] as? [String: Any],
              let needsYou = count(counts["needsYou"]),
              let running = count(counts["running"]) else { return nil }
        let engine = top["engine"] as? [String: Any] ?? [:]
        return ShellStatus(needsYou: needsYou, running: running,
                           board: state(engine["board"]), books: state(engine["books"]), gate: state(engine["gate"]))
    }

    static func count(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let kind = String(cString: n.objCType)
        guard kind != "d", kind != "f" else { return nil }
        let i = n.int64Value
        guard i >= 0, i <= Int64(maxCount) else { return nil }
        return Int(i)
    }

    static func state(_ v: Any?) -> PartState {
        switch v as? String {
        case "on": return .on
        case "off": return .off
        case "not_installed": return .notInstalled
        default: return .unknown
        }
    }
}
