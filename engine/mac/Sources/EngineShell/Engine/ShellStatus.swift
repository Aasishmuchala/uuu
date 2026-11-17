import Foundation

public enum PartState { case on, off, notInstalled, unknown }

public struct ShellStatus {
    public var needsYou: Int
    public var running: Int
    public var board: PartState
    public var books: PartState
    public var gate: PartState

    public init(needsYou: Int, running: Int, board: PartState, books: PartState, gate: PartState) {
        self.needsYou = needsYou; self.running = running
        self.board = board; self.books = books; self.gate = gate
    }

    public static func parse(_ data: Data) -> ShellStatus? {
        fatalError("M3")
    }
}
