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
        // The script's output goes to a file of its own, not a pipe: if the app goes away mid-run (the owner
        // quits during "Starting the engine"), the script keeps writing and runs to its end instead of dying
        // at its next line with some parts on and some off (M15, M4). The file is unlinked at once, so only
        // this run's open descriptors reach it, and it is gone when the last of them closes.
        guard let output = OutputFile.make() else { return (-1, []) }
        defer { output.close() }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [EngineRoot.script(in: root).path, verb.word]
        proc.currentDirectoryURL = root
        proc.environment = EngineEnvironment.forThisUser()
        guard let null = FileHandle(forReadingAtPath: "/dev/null") else { return (-1, []) }
        proc.standardInput = null
        proc.standardOutput = output.handle
        proc.standardError = output.handle

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

        let code = proc.terminationReason == .uncaughtSignal ? 128 + proc.terminationStatus : proc.terminationStatus
        return (code, lines(from: output.tail()))
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

// Where the script's output goes: an unlinked file in this user's own temp folder (the system's, not TMPDIR's),
// read once the script has ended. Only the last 512 KB are read, enough for 200 lines of 500 characters.
private final class OutputFile {
    let handle: FileHandle
    private static let keep: off_t = 512 * 1024

    private init(_ handle: FileHandle) { self.handle = handle }

    static func make() -> OutputFile? {
        var template = Array((EngineEnvironment.systemTemp() + "engine-output.XXXXXX").utf8CString)
        let fd = template.withUnsafeMutableBufferPointer { mkstemp($0.baseAddress!) }
        guard fd >= 0 else { return nil }
        let path = template.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
        unlink(path)
        return OutputFile(FileHandle(fileDescriptor: fd, closeOnDealloc: true))
    }

    func tail() -> Data {
        let fd = handle.fileDescriptor
        let end = lseek(fd, 0, SEEK_END)
        guard end > 0 else { return Data() }
        let from = max(0, end - OutputFile.keep)
        guard lseek(fd, from, SEEK_SET) == from else { return Data() }
        var data = Data()
        var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while data.count < Int(end - from) {
            let n = read(fd, &buf, buf.count)
            if n <= 0 { break }
            data.append(contentsOf: buf[0..<n])
        }
        guard from > 0, let nl = data.firstIndex(of: 0x0A) else { return data }
        return Data(data[data.index(after: nl)...])   // the first line was cut by the trim
    }

    func close() { try? handle.close() }
}
