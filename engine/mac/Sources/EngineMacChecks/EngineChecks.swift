import Darwin
import EngineShell
import Foundation
import IOKit.pwr_mgt

// M3: the engine's switch, the poll and keep-awake. Every run goes to a stand-in `engine` script in a temp
// folder; the real engine/bin/engine is never run. The poll talks to a small server of these checks on a
// free port the system picks (always above 3300 and never one of the engine's).

func engineChecks() -> [Check] {
    envChecks() + rootChecks() + runChecks() + switchChecks() + pollChecks() + awakeChecks() + badgeChecks() + notifyChecks()
}

// ---- helpers (private to this file) -----------------------------------------------------------------------

private struct Failure: Error, CustomStringConvertible { let description: String }

private func expect(_ ok: Bool, _ why: @autoclosure () -> String) throws {
    if !ok { throw Failure(description: why()) }
}

private func same<T: Equatable>(_ got: T, _ want: T, _ what: String = "") throws {
    if got != want { throw Failure(description: "\(what) got \(got), want \(want)") }
}

// Runs an async body to its end from the checks' synchronous code.
private func blocking<T>(_ body: @escaping () async -> T) -> T {
    let done = DispatchSemaphore(value: 0)
    var out: T?
    Task.detached { out = await body(); done.signal() }
    done.wait()
    return out!
}

// Spins the main run loop (the poll answers on the main queue) until `ready` or the time is up.
private func spin(_ seconds: TimeInterval, until ready: () -> Bool) -> Bool {
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
        if ready() { return true }
        RunLoop.main.run(until: Date().addingTimeInterval(0.02))
    }
    return ready()
}

private let seven = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "SHELL"]
private let poison = ["OPENAI_API_KEY": "a", "ANTHROPIC_API_KEY": "b", "PAPERCLIP_API_URL": "c", "ENGINE_CONFIG": "d",
                      "ENGINE_PARTS_DIR": "e", "NODE_OPTIONS": "f", "DYLD_INSERT_LIBRARIES": "g"]

// A stand-in checkout in a temp folder: <dir>/root/engine/bin/engine holding `body`, records in <dir>.
private final class StandIn {
    let dir: URL
    let root: URL
    var script: URL { root.appendingPathComponent("engine/bin/engine") }
    var record: URL { dir.appendingPathComponent("record") }

    init(_ body: String = StandIn.recorder, mode: Int = 0o755) throws {
        let base = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("engine-mac-checks-\(UUID().uuidString)")
        dir = base
        root = base.appendingPathComponent("root")
        let bin = root.appendingPathComponent("engine/bin")
        try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o755])
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: base.path)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: root.path)
        let text = "#!/bin/bash\nREC='\(base.path)'\n" + body
        try text.write(to: script, atomically: false, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: mode], ofItemAtPath: script.path)
    }

    deinit { try? FileManager.default.removeItem(at: dir) }

    func read(_ name: String = "record") -> String {
        (try? String(contentsOf: dir.appendingPathComponent(name), encoding: .utf8)) ?? ""
    }

    // Prints its arguments, where it ran, what its stdin is and `env | sort` into the record.
    static let recorder = """
    {
      echo "argc:$#"
      echo "args:$*"
      echo "zero:$0"
      echo "cwd:$(/bin/pwd -P)"
      echo "stdin:$(/usr/bin/stat -L -f %HT /dev/stdin)"
      echo "stdin-bytes:$(/bin/cat | /usr/bin/wc -c | /usr/bin/tr -d ' ')"
      echo "--env"
      /usr/bin/env | /usr/bin/sort
    } > "$REC/record"
    echo "said $1"
    echo "to stderr" >&2
    exit 3

    """
}

// What the stand-in saw: its environment as KEY -> value, and the lines before it.
private func parseRecord(_ text: String) -> (head: [String: String], env: [String: String]) {
    var head: [String: String] = [:], env: [String: String] = [:]
    var inEnv = false
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
        if line == "--env" { inEnv = true; continue }
        guard let eq = line.firstIndex(of: inEnv ? "=" : ":") else { continue }
        let k = String(line[..<eq]), v = String(line[line.index(after: eq)...])
        if inEnv { env[k] = v } else { head[k] = v }
    }
    return (head, env)
}

// The path with every link resolved, as the system gives it (/var/folders -> /private/var/folders).
private func physical(_ path: String) -> String {
    guard let r = realpath(path, nil) else { return path }
    defer { free(r) }
    return String(cString: r)
}

private func alive(_ pid: pid_t) -> Bool { kill(pid, 0) == 0 || errno == EPERM }

// This user's home folder and name from the user database, and the temp folder from the system, read here
// without EngineShell so the checks do not take its word for it.
private func systemUser() throws -> (home: String, name: String, tmp: String) {
    guard let pw = getpwuid(getuid()) else { throw Failure(description: "getpwuid") }
    let home = String(cString: pw.pointee.pw_dir), name = String(cString: pw.pointee.pw_name)
    var buf = [CChar](repeating: 0, count: Int(PATH_MAX))
    guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buf, buf.count) > 0 else { throw Failure(description: "confstr") }
    return (home, name, String(cString: buf))
}

// Runs this program again with `args` and exactly `env`; its standard output.
private func runSelf(_ args: [String], env: [String: String]) throws -> String {
    let p = Process()
    guard let me = Bundle.main.executableURL else { throw Failure(description: "no executable") }
    p.executableURL = me
    p.arguments = args
    p.environment = env
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    try p.run()
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    try same(p.terminationStatus, 0, "the helper's exit")
    return String(decoding: data, as: UTF8.self)
}

// ---- env: --------------------------------------------------------------------------------------------------

private func envChecks() -> [Check] {
    let built = EngineEnvironment.build(home: "/Users/someone", user: "someone", tmp: "/var/folders/x/T/")
    return [
        Check(name: "env: exactly the seven keys") {
            try same(Set(built.keys), Set(seven), "keys")
        },
        Check(name: "env: PATH, LANG and SHELL are fixed") {
            try same(built["PATH"], "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin", "PATH")
            try same(built["LANG"], "en_US.UTF-8", "LANG")
            try same(built["SHELL"], "/bin/bash", "SHELL")
        },
        Check(name: "env: path has six folders in the pinned order") {
            let folders = EngineEnvironment.path.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            try same(folders, ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin"], "folders")
            try same(Set(folders).count, 6, "distinct")
            try same(built["PATH"], EngineEnvironment.path, "built PATH")
        },
        Check(name: "env: no folder under the home folder") {
            let homes = ["/Users/", "/var/root", NSHomeDirectory(), physical(NSHomeDirectory())]
            for folder in EngineEnvironment.path.split(separator: ":").map(String.init) {
                try expect(folder.hasPrefix("/") && !folder.contains("~") && !folder.contains("$"), "\(folder) is not a fixed path")
                for h in homes { try expect(!folder.hasPrefix(h), "\(folder) is under \(h)") }
                try expect(!folder.contains("/.local/") && !folder.contains("nvm"), "\(folder)")
            }
            let mine = EngineEnvironment.forThisUser()
            try same(mine["PATH"], EngineEnvironment.path, "the app's PATH")
        },
        Check(name: "env: still seven keys") {
            try same(built.count, 7, "count")
            try same(EngineEnvironment.forThisUser().count, 7, "the app's count")
            try same(Set(EngineEnvironment.forThisUser().keys), Set(seven), "the app's keys")
        },
        Check(name: "env: HOME, USER, LOGNAME and TMPDIR come from the arguments") {
            try same(built["HOME"], "/Users/someone", "HOME")
            try same(built["USER"], "someone", "USER")
            try same(built["LOGNAME"], "someone", "LOGNAME")
            try same(built["TMPDIR"], "/var/folders/x/T/", "TMPDIR")
        },
        Check(name: "env: the app's values are the system's, not its environment's") {
            let was = getenv("HOME").map { String(cString: $0) }
            setenv("HOME", "/tmp/not-home", 1)
            defer { if let was = was { setenv("HOME", was, 1) } else { unsetenv("HOME") } }
            let mine = EngineEnvironment.forThisUser()
            let sys = try systemUser()
            try same(mine["HOME"], sys.home, "HOME")
            try expect(mine["HOME"] != "/tmp/not-home", "HOME was read from the environment")
            try same(mine["USER"], sys.name, "USER")
            try same(mine["LOGNAME"], sys.name, "LOGNAME")
            try same(mine["TMPDIR"], sys.tmp, "TMPDIR")
            try same(Set(mine.keys), Set(seven), "keys")
        },
        Check(name: "env: an app started with CFFIXED_USER_HOME, HOME, TMPDIR, USER and LOGNAME set still gives the system's") {
            // M15's M2: NSHomeDirectory() honours CFFIXED_USER_HOME and NSTemporaryDirectory() honours TMPDIR,
            // and both are read when the process starts, so this runs in a process of its own.
            let out = try runSelf(["--print-env"], env: [
                "CFFIXED_USER_HOME": "/tmp/cf-fixed-home", "HOME": "/tmp/not-home", "TMPDIR": "/tmp/not-tmp/",
                "USER": "someone-else", "LOGNAME": "someone-else", "PATH": "/tmp/not-path",
            ])
            var got: [String: String] = [:]
            for line in out.split(separator: "\n") {
                if let eq = line.firstIndex(of: "=") { got[String(line[..<eq])] = String(line[line.index(after: eq)...]) }
            }
            let sys = try systemUser()
            try same(Set(got.keys), Set(seven), "keys")
            try same(got["HOME"], sys.home, "HOME")
            try same(got["USER"], sys.name, "USER")
            try same(got["LOGNAME"], sys.name, "LOGNAME")
            try same(got["TMPDIR"], sys.tmp, "TMPDIR")
            try same(got["PATH"], EngineEnvironment.path, "PATH")
        },
        Check(name: "env: none of the forbidden keys is ever built, whatever the caller holds") {
            for (k, v) in poison { setenv(k, v, 1) }
            defer { for k in poison.keys { unsetenv(k) } }
            let mine = EngineEnvironment.forThisUser()
            for k in poison.keys { try expect(mine[k] == nil, "\(k) is in the built environment") }
        },
        Check(name: "env: the stand-in sees the seven keys and nothing of the caller's") {
            let s = try StandIn()
            for (k, v) in poison { setenv(k, v, 1) }
            defer { for k in poison.keys { unsetenv(k) } }
            _ = blocking { await EngineCommand.run(.status, root: s.root) }
            let env = parseRecord(s.read()).env
            // bash itself adds PWD, SHLVL and _ for what it runs; nothing else may appear.
            let extra = Set(env.keys).subtracting(seven).subtracting(["PWD", "SHLVL", "_", "OLDPWD"])
            try expect(extra.isEmpty, "unexpected keys \(extra.sorted())")
            try same(Set(env.keys).intersection(seven), Set(seven), "the seven")
            let want = EngineEnvironment.forThisUser()
            for k in seven { try same(env[k], want[k], k) }
            for k in poison.keys { try expect(env[k] == nil, "\(k) reached the stand-in") }
        },
    ]
}

// ---- root: -------------------------------------------------------------------------------------------------

private func rootChecks() -> [Check] {
    func fault(_ r: Result<URL, RootFault>) -> RootFault? {
        if case .failure(let f) = r { return f }
        return nil
    }
    return [
        Check(name: "root: a good root (in a temp folder, with allowTemp) is ok, resolved") {
            let s = try StandIn()
            guard case .success(let url) = EngineRoot.check(path: s.root.path, allowTemp: true) else {
                throw Failure(description: "refused")
            }
            try same(url.path, physical(s.root.path), "path")
        },
        Check(name: "root: a root under the temp folder is refused without allowTemp") {
            let s = try StandIn()
            try same(fault(EngineRoot.check(path: s.root.path)), .notSafe, "check(path:)")
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: false)), .notSafe, "allowTemp false")
        },
        Check(name: "root: /tmp and /private/tmp roots are refused without allowTemp") {
            try same(fault(EngineRoot.check(path: "/tmp")), .notSafe, "/tmp")
            try same(fault(EngineRoot.check(path: "/private/tmp")), .notSafe, "/private/tmp")
        },
        Check(name: "root: an empty path (a development build) is not found") {
            try same(fault(EngineRoot.check(path: "")), .notFound, "")
        },
        Check(name: "root: a relative path is refused") {
            try same(fault(EngineRoot.check(path: "uuu", allowTemp: true)), .notSafe, "uuu")
            try same(fault(EngineRoot.check(path: "./x", allowTemp: true)), .notSafe, "./x")
        },
        Check(name: "root: a path with .. or a hidden folder is refused") {
            let s = try StandIn()
            try same(fault(EngineRoot.check(path: s.root.path + "/../root", allowTemp: true)), .notSafe, "..")
            let hidden = s.dir.appendingPathComponent(".hidden")
            try FileManager.default.createDirectory(at: hidden.appendingPathComponent("engine/bin"),
                                                    withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: s.script, to: hidden.appendingPathComponent("engine/bin/engine"))
            try same(fault(EngineRoot.check(path: hidden.path, allowTemp: true)), .notSafe, ".hidden")
        },
        Check(name: "root: a missing folder is not found") {
            let s = try StandIn()
            try same(fault(EngineRoot.check(path: s.dir.appendingPathComponent("nope").path, allowTemp: true)),
                     .notFound, "missing")
        },
        Check(name: "root: a root that is a link is refused") {
            let s = try StandIn()
            let link = s.dir.appendingPathComponent("link")
            try FileManager.default.createSymbolicLink(at: link, withDestinationURL: s.root)
            try same(fault(EngineRoot.check(path: link.path, allowTemp: true)), .notSafe, "link")
        },
        Check(name: "root: a root that is a file is refused") {
            let s = try StandIn()
            try same(fault(EngineRoot.check(path: s.record.path + "x", allowTemp: true)), .notFound, "missing file")
            try "x".write(to: s.record, atomically: false, encoding: .utf8)
            try same(fault(EngineRoot.check(path: s.record.path, allowTemp: true)), .notSafe, "file")
        },
        Check(name: "root: a root others can write is refused") {
            let s = try StandIn()
            try FileManager.default.setAttributes([.posixPermissions: 0o777], ofItemAtPath: s.root.path)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "0777")
            try FileManager.default.setAttributes([.posixPermissions: 0o775], ofItemAtPath: s.root.path)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "0775")
        },
        Check(name: "root: engine/bin/engine as a link is refused") {
            let s = try StandIn()
            let real = s.dir.appendingPathComponent("real-engine")
            try FileManager.default.moveItem(at: s.script, to: real)
            try FileManager.default.createSymbolicLink(at: s.script, withDestinationURL: real)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "link")
        },
        Check(name: "root: engine/bin/engine with mode 0777 or 0775 is refused") {
            let s = try StandIn(mode: 0o777)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "0777")
            try FileManager.default.setAttributes([.posixPermissions: 0o775], ofItemAtPath: s.script.path)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "0775")
        },
        Check(name: "root: engine/bin/engine missing, or a folder, is refused") {
            let s = try StandIn()
            try FileManager.default.removeItem(at: s.script)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notFound, "missing")
            try FileManager.default.createDirectory(at: s.script, withIntermediateDirectories: false)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "folder")
        },
        // M15's L2: what lies between the root and the script, and the folder the root sits in.
        Check(name: "root: engine/bin as a link to another folder is refused") {
            let s = try StandIn()
            let elsewhere = s.dir.appendingPathComponent("elsewhere")
            try FileManager.default.moveItem(at: s.root.appendingPathComponent("engine/bin"), to: elsewhere)
            try FileManager.default.createSymbolicLink(at: s.root.appendingPathComponent("engine/bin"), withDestinationURL: elsewhere)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "engine/bin link")
        },
        Check(name: "root: engine as a link to another checkout's engine is refused") {
            let s = try StandIn(), other = try StandIn()
            try FileManager.default.removeItem(at: s.root.appendingPathComponent("engine"))
            try FileManager.default.createSymbolicLink(at: s.root.appendingPathComponent("engine"),
                                                       withDestinationURL: other.root.appendingPathComponent("engine"))
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "engine link")
        },
        Check(name: "root: engine or engine/bin that others can write is refused") {
            for (folder, mode) in [("engine", 0o777), ("engine", 0o775), ("engine/bin", 0o777), ("engine/bin", 0o775)] {
                let s = try StandIn()
                try FileManager.default.setAttributes([.posixPermissions: mode],
                                                      ofItemAtPath: s.root.appendingPathComponent(folder).path)
                try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "\(folder) \(String(mode, radix: 8))")
            }
        },
        Check(name: "root: a root whose parent others can write is refused") {
            let s = try StandIn()
            try FileManager.default.setAttributes([.posixPermissions: 0o777], ofItemAtPath: s.dir.path)
            try same(fault(EngineRoot.check(path: s.root.path, allowTemp: true)), .notSafe, "parent 0777")
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: s.dir.path)
            guard case .success = EngineRoot.check(path: s.root.path, allowTemp: true) else {
                throw Failure(description: "parent 0755 refused")
            }
        },
        Check(name: "root: the temp folder is the system's, not TMPDIR's") {
            // A development build runs status only on a root under a temp folder; an app started with TMPDIR
            // naming a real checkout must not make that checkout count as one.
            let code = physical(URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().path)
            let out = try runSelf(["--under-temp", code], env: ["TMPDIR": code + "/"])
            try same(out, "no\n", "under temp")
            let tmp = try runSelf(["--under-temp", physical(try systemUser().tmp) + "/x"], env: ["TMPDIR": code + "/"])
            try same(tmp, "yes\n", "the system's own temp folder")
        },
    ]
}

// ---- run: --------------------------------------------------------------------------------------------------

private let quick = EngineLimits(start: 1, stop: 1, status: 1.5)

// ---- switch: (PLAN-MAC-2 N4b) ------------------------------------------------------------------------------

private func switchChecks() -> [Check] {
    [
        Check(name: "switch: a development build is unavailable with W8, and start gives (-1, [W8])") {
            let s = try StandIn()
            for compiled in ["", s.root.path] {
                let sw: EngineSwitch = LocalEngineSwitch(flavor: "dev", compiledRoot: compiled)
                try same(sw.state, .unavailable(EngineWords.devBuild), "state (\(compiled.isEmpty ? "empty" : "stand-in"))")
                let r = blocking { await sw.run(.start) }
                try same(r.exit, -1, "exit")
                try same(r.lines, [EngineWords.devBuild], "lines")
                let q = blocking { await sw.run(.status) }
                try same(q.lines, [EngineWords.devBuild], "status lines")
            }
            let t = LocalEngineSwitch(flavor: "dev", compiledRoot: s.root.path, allowTemp: true)
            try same(t.state, .unavailable(EngineWords.devBuild), "allowTemp changes nothing for dev")
            try expect(!FileManager.default.fileExists(atPath: s.record.path), "the stand-in ran")
        },
        Check(name: "switch: a release build with a bad compiled root is unavailable with W10") {
            let s = try StandIn(), bad = try StandIn(mode: 0o777)
            for (compiled, temp) in [("", true), ("/nope", true), (bad.root.path, true), (s.root.path, false)] {
                let sw = LocalEngineSwitch(flavor: "release", compiledRoot: compiled, allowTemp: temp)
                try same(sw.state, .unavailable(EngineWords.badRoot), "state \(compiled) allowTemp \(temp)")
                for verb in EngineVerb.allCases {
                    let r = blocking { await sw.run(verb) }
                    try same(r.exit, -1, "\(verb) exit")
                    try same(r.lines, [EngineWords.badRoot], "\(verb) lines")
                }
            }
            try same(LocalEngineSwitch(flavor: "release", compiledRoot: s.root.path).state,
                     .unavailable(EngineWords.badRoot), "the public init never allows a temp root")
            try expect(!FileManager.default.fileExists(atPath: s.record.path), "the stand-in ran")
            try expect(!FileManager.default.fileExists(atPath: bad.record.path), "the unsafe stand-in ran")
        },
        Check(name: "switch: a release build with a good stand-in root is ready, and status gives its lines") {
            let s = try StandIn()
            let sw: EngineSwitch = LocalEngineSwitch(flavor: "release", compiledRoot: s.root.path, allowTemp: true)
            try same(sw.state, .ready, "state")
            let r = blocking { await sw.run(.status) }
            try same(r.exit, 3, "exit")
            try expect(r.lines.contains("said status") && r.lines.contains("to stderr"), "lines \(r.lines)")
            try same(parseRecord(s.read()).head["args"], "status", "args")
        },
        Check(name: "switch: a root made unsafe after the switch was made turns it to W10") {
            let s = try StandIn()
            let sw = LocalEngineSwitch(flavor: "release", compiledRoot: s.root.path, allowTemp: true)
            try same(sw.state, .ready, "before")
            try FileManager.default.setAttributes([.posixPermissions: 0o777], ofItemAtPath: s.script.path)
            try same(sw.state, .unavailable(EngineWords.badRoot), "after")
            let r = blocking { await sw.run(.status) }
            try same(r.lines, [EngineWords.badRoot], "lines")
            try expect(!FileManager.default.fileExists(atPath: s.record.path), "the stand-in ran")
        },
    ]
}

private func runChecks() -> [Check] {
    [
        Check(name: "run: the checks are a development build") {
            try same(BuildConstants.flavor, "dev", "flavor")
            try same(BuildConstants.engineRoot, "", "engineRoot")
        },
        Check(name: "run: a development build cannot start or stop the engine, and the script never runs") {
            let s = try StandIn()
            for verb in [EngineVerb.start, .stop] {
                let r = blocking { await EngineCommand.run(verb, root: s.root) }
                try same(r.exit, -1, "\(verb) exit")
                try same(r.lines, [EngineWords.devBuild], "\(verb) lines")
                let q = blocking { await EngineCommand.run(verb, root: s.root, limits: quick) }
                try same(q.lines, [EngineWords.devBuild], "\(verb) lines (short limits)")
            }
            try expect(!FileManager.default.fileExists(atPath: s.record.path), "the stand-in ran")
        },
        Check(name: "run: a development build runs status only on a stand-in under a temp folder") {
            let code = URL(fileURLWithPath: #filePath).deletingLastPathComponent()   // a real folder, not temp
            try same(EngineCommand.refusal(.status, flavor: "dev", compiledRoot: "", root: code, allowTemp: true),
                     EngineWords.devBuild, "non-temp root")
            try same(EngineCommand.refusal(.status, flavor: "dev", compiledRoot: "", root: URL(fileURLWithPath: "/nope"),
                                           allowTemp: true), EngineWords.devBuild, "missing root")
            let s = try StandIn(mode: 0o777)
            try same(EngineCommand.refusal(.status, flavor: "dev", compiledRoot: "", root: s.root, allowTemp: true),
                     EngineWords.devBuild, "unsafe stand-in")
            let r = blocking { await EngineCommand.run(.status, root: s.root) }
            try same(r.lines, [EngineWords.devBuild], "lines")
            try expect(!FileManager.default.fileExists(atPath: s.record.path), "the unsafe stand-in ran")
        },
        Check(name: "run: a release build runs only the root compiled into it, while it passes the check") {
            let s = try StandIn(), other = try StandIn()
            for verb in EngineVerb.allCases {
                try same(EngineCommand.refusal(verb, flavor: "release", compiledRoot: s.root.path, root: s.root,
                                               allowTemp: true), nil, "\(verb) own root")
                try same(EngineCommand.refusal(verb, flavor: "release", compiledRoot: s.root.path, root: other.root,
                                               allowTemp: true), EngineWords.badRoot, "\(verb) another root")
                try same(EngineCommand.refusal(verb, flavor: "release", compiledRoot: "", root: s.root,
                                               allowTemp: true), EngineWords.badRoot, "\(verb) empty compiled root")
                try same(EngineCommand.refusal(verb, flavor: "release", compiledRoot: s.root.path, root: s.root,
                                               allowTemp: false), EngineWords.badRoot, "\(verb) temp root, no allowTemp")
            }
            try FileManager.default.setAttributes([.posixPermissions: 0o777], ofItemAtPath: s.script.path)
            try same(EngineCommand.refusal(.start, flavor: "release", compiledRoot: s.root.path, root: s.root,
                                           allowTemp: true), EngineWords.badRoot, "script made writable")
        },
        Check(name: "run: exactly /bin/bash <root>/engine/bin/engine status, in the root, stdin from /dev/null") {
            let s = try StandIn()
            let r = blocking { await EngineCommand.run(.status, root: s.root, limits: quick) }
            let head = parseRecord(s.read()).head
            try same(head["argc"], "1", "argc")
            try same(head["args"], "status", "args")
            try same(head["zero"], s.script.path, "$0")
            try same(head["cwd"], physical(s.root.path), "cwd")
            try same(head["stdin"], "Character Device", "stdin")
            try same(head["stdin-bytes"], "0", "stdin bytes")
            try same(r.exit, 3, "exit")
        },
        Check(name: "run: stdout and stderr are both kept") {
            let s = try StandIn()
            let r = blocking { await EngineCommand.run(.status, root: s.root, limits: quick) }
            try expect(r.lines.contains("said status"), "stdout missing: \(r.lines)")
            try expect(r.lines.contains("to stderr"), "stderr missing: \(r.lines)")
        },
        Check(name: "run: the last 200 lines, each at most 500 characters, control characters removed") {
            let s = try StandIn("""
            i=1; while [ $i -le 450 ]; do echo "line $i"; i=$((i + 1)); done
            printf 'x%.0s' $(/usr/bin/jot 700); echo
            printf 'a\\033[31mb\\tc\\342\\200\\256d\\r\\n'
            exit 0

            """)
            let r = blocking { await EngineCommand.run(.status, root: s.root, limits: quick) }
            try same(r.exit, 0, "exit")
            try same(r.lines.count, 200, "count")
            try same(r.lines.first, "line 253", "first kept")
            try same(r.lines[198], String(repeating: "x", count: 500), "long line")
            try same(r.lines.last, "a[31mbcd", "cleaned line")
        },
        Check(name: "run: the line rule on its own") {
            try same(EngineCommand.lines(from: Data()), [], "empty")
            try same(EngineCommand.lines(from: Data("one\n\ntwo\n".utf8)), ["one", "", "two"], "blank kept")
            try same(EngineCommand.clean("\u{2066}a\u{0}b\u{7F}c\u{85}d\u{200F}"), "abcd", "controls")
            try same(EngineCommand.clean(String(repeating: "é", count: 600)).count, 500, "cut")
        },
        Check(name: "run: one at a time; a second call while one runs gets W9 and runs nothing") {
            let s = try StandIn("""
            echo started > "$REC/started"
            /bin/sleep 1
            echo "count" >> "$REC/runs"
            exit 0

            """)
            let started = Date()
            let first = Task.detached { await EngineCommand.run(.status, root: s.root, limits: quick) }
            try expect(spin(5) { FileManager.default.fileExists(atPath: s.dir.appendingPathComponent("started").path) },
                       "the first run did not start")
            let second = blocking { await EngineCommand.run(.status, root: s.root, limits: quick) }
            try same(second.exit, -1, "second exit")
            try same(second.lines, [EngineWords.busy], "second lines")
            let one = blocking { await first.value }
            try same(one.exit, 0, "first exit")
            try expect(Date().timeIntervalSince(started) < 4, "too slow")
            let third = blocking { await EngineCommand.run(.status, root: s.root, limits: quick) }
            try same(third.exit, 0, "a run after the first ended")
            try same(s.read("runs"), "count\ncount\n", "runs")
        },
        Check(name: "run: past its time limit the script's one PID gets SIGTERM; its child is left alone") {
            let s = try StandIn("""
            echo $$ > "$REC/self"
            /bin/sleep 30 &
            echo $! > "$REC/child"
            echo waiting
            wait
            echo never

            """)
            let t0 = Date()
            let r = blocking { await EngineCommand.run(.status, root: s.root, limits: quick) }
            let took = Date().timeIntervalSince(t0)
            let me = pid_t(s.read("self").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            let child = pid_t(s.read("child").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            defer { if child > 0 { kill(child, SIGKILL) } }   // ours, by PID
            try same(r.exit, 128 + SIGTERM, "exit")
            try expect(took >= 1.4 && took < 4.5, "took \(took) s")
            try same(r.lines, ["waiting"], "lines")
            try expect(me > 0 && !alive(me), "the script is still running")
            try expect(child > 0 && alive(child), "the child was chased")
        },
        Check(name: "run: the app ended mid-run by PID: the script still runs to its end") {
            // M15's M4: with the output through a pipe, the script died at its first line after the app went.
            let s = try StandIn("""
            echo one; : > "$REC/mark-one"
            /bin/sleep 1
            echo two; : > "$REC/mark-two"
            /bin/sleep 0.3
            echo three; : > "$REC/mark-three"
            exit 0

            """)
            let p = Process()
            guard let me = Bundle.main.executableURL else { throw Failure(description: "no executable") }
            p.executableURL = me
            p.arguments = ["--run-status", s.root.path]
            p.standardOutput = FileHandle.nullDevice
            p.standardError = FileHandle.nullDevice
            try p.run()
            let pid = p.processIdentifier
            defer { if alive(pid) { kill(pid, SIGKILL) } }
            let mark = { (n: String) in FileManager.default.fileExists(atPath: s.dir.appendingPathComponent("mark-\(n)").path) }
            try expect(spin(10) { mark("one") }, "the stand-in did not start")
            try expect(!mark("two"), "too late to end the app mid-run")
            kill(pid, SIGKILL)   // ours, by PID
            p.waitUntilExit()
            try expect(spin(5) { mark("three") }, "the script stopped when the app went (two: \(mark("two")))")
        },
        Check(name: "run: the limits are 600 s to start, 180 s to stop, 60 s for status") {
            try same(EngineLimits.standard.seconds(for: .start), 600, "start")
            try same(EngineLimits.standard.seconds(for: .stop), 180, "stop")
            try same(EngineLimits.standard.seconds(for: .status), 60, "status")
        },
    ]
}

// ---- poll: -------------------------------------------------------------------------------------------------

// A small HTTP server on 127.0.0.1 and a port the system picks. Each request is answered by `route` on its
// own thread, then the connection is closed. Every request line and its headers are kept.
private final class TinyServer {
    struct Reply { var status = 200; var headers: [String] = []; var body = Data(); var delay: TimeInterval = 0 }

    let port: Int
    private let fd: Int32
    private let lock = NSLock()
    private var seen: [String] = []
    private var closed = false
    var route: (String) -> Reply

    init(_ route: @escaping (String) -> Reply) throws {
        let sock = socket(AF_INET, SOCK_STREAM, 0)
        guard sock >= 0 else { throw Failure(description: "socket") }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(sock, $0, len) } }
        guard bound == 0, listen(sock, 16) == 0 else { close(sock); throw Failure(description: "bind") }
        _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(sock, $0, &len) } }
        let picked = Int(UInt16(bigEndian: addr.sin_port))
        let forbidden = (3100...3299).contains(picked) || [5000, 5432, 7000, 8120].contains(picked) || picked <= 3300
        guard !forbidden else { close(sock); throw Failure(description: "the system gave port \(picked)") }
        self.route = route
        fd = sock
        port = picked
        let listener = sock
        Thread.detachNewThread { [weak self] in
            while true {
                let c = accept(listener, nil, nil)
                if c < 0 { return }
                guard let self = self else { close(c); return }
                Thread.detachNewThread { self.answer(c) }
            }
        }
    }

    var requests: [String] { lock.lock(); defer { lock.unlock() }; return seen }

    func shut() {
        lock.lock(); defer { lock.unlock() }
        if closed { return }
        closed = true
        shutdown(fd, SHUT_RDWR)
        close(fd)
    }

    deinit { shut() }

    private func answer(_ c: Int32) {
        var one: Int32 = 1
        setsockopt(c, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        var got = Data()
        var buf = [UInt8](repeating: 0, count: 4096)
        while got.range(of: Data("\r\n\r\n".utf8)) == nil {
            let n = read(c, &buf, buf.count)
            if n <= 0 { close(c); return }
            got.append(buf, count: n)
        }
        let head = String(decoding: got, as: UTF8.self)
        lock.lock(); seen.append(head); lock.unlock()
        let path = head.split(separator: " ").dropFirst().first.map(String.init) ?? ""
        let reply = route(path)
        if reply.delay > 0 { Thread.sleep(forTimeInterval: reply.delay) }
        var text = "HTTP/1.1 \(reply.status) X\r\nContent-Length: \(reply.body.count)\r\nConnection: close\r\n"
        for h in reply.headers { text += h + "\r\n" }
        text += "\r\n"
        var out = Data(text.utf8)
        out.append(reply.body)
        out.withUnsafeBytes { raw in
            var off = 0
            while off < raw.count {
                let n = write(c, raw.baseAddress! + off, raw.count - off)
                if n <= 0 { break }
                off += n
            }
        }
        close(c)
    }
}

private let goodShell = #"{"counts":{"needsYou":3,"running":1,"tasksOpen":9},"engine":{"board":"on","books":"not_installed","gate":"off"},"agents":[{"name":"<script>"}]}"#

private func json(_ s: String) -> TinyServer.Reply { TinyServer.Reply(status: 200, headers: ["Content-Type: application/json"], body: Data(s.utf8)) }

// One reading against `server`, waited for on the main run loop.
private func readOnce(_ poller: Poller, within: TimeInterval = 8) throws -> Poller.State {
    var state: Poller.State?
    poller.pollOnce { state = $0 }
    try expect(spin(within) { state != nil }, "no answer in \(within) s")
    return state!
}

private func pollChecks() -> [Check] {
    func parsed(_ s: String) -> ShellStatus? { ShellStatus.parse(Data(s.utf8)) }
    return [
        Check(name: "poll: parse, the full vector") {
            try same(parsed(#"{"counts":{"needsYou":3,"running":1,"tasksOpen":9},"engine":{"board":"on","books":"not_installed","gate":"off"}}"#),
                     ShellStatus(needsYou: 3, running: 1, board: .on, books: .notInstalled, gate: .off))
        },
        Check(name: "poll: parse, a count as a string is nil") {
            try same(parsed(#"{"counts":{"needsYou":"3"}}"#), nil)
            try same(parsed(#"{"counts":{"needsYou":"3","running":0}}"#), nil)
        },
        Check(name: "poll: parse, a negative count is nil") {
            try same(parsed(#"{"counts":{"needsYou":-1,"running":0},"engine":{}}"#), nil)
        },
        Check(name: "poll: parse, a state that is not one of the words is unknown") {
            try same(parsed(#"{"counts":{"needsYou":2,"running":0},"engine":{"board":"<b>on</b>"}}"#),
                     ShellStatus(needsYou: 2, running: 0, board: .unknown, books: .unknown, gate: .unknown))
            try same(parsed(#"{"counts":{"needsYou":0,"running":0},"engine":{"board":"ON","books":1,"gate":null}}"#),
                     ShellStatus(needsYou: 0, running: 0, board: .unknown, books: .unknown, gate: .unknown))
        },
        Check(name: "poll: parse, not JSON, empty, an array, or 2 MB of [ is nil") {
            try same(parsed("not json"), nil, "text")
            try same(ShellStatus.parse(Data()), nil, "empty")
            try same(parsed("[1,2]"), nil, "array")
            try same(ShellStatus.parse(Data(repeating: UInt8(ascii: "["), count: 2 * 1024 * 1024)), nil, "2 MB")
            try same(ShellStatus.parse(Data(repeating: UInt8(ascii: "["), count: 900 * 1024)), nil, "900 KB of [")
        },
        Check(name: "poll: parse, counts outside 0 to 100,000, fractions, booleans and huge numbers are nil") {
            try same(parsed(#"{"counts":{"needsYou":100000,"running":0}}"#)?.needsYou, 100_000, "100,000")
            try same(parsed(#"{"counts":{"needsYou":100001,"running":0}}"#), nil, "100,001")
            try same(parsed(#"{"counts":{"needsYou":1.5,"running":0}}"#), nil, "1.5")
            try same(parsed(#"{"counts":{"needsYou":true,"running":0}}"#), nil, "true")
            try same(parsed(#"{"counts":{"needsYou":18446744073709551615,"running":0}}"#), nil, "2^64-1")
            try same(parsed(#"{"counts":{"needsYou":1}}"#), nil, "running missing")
            try same(parsed(#"{"engine":{"board":"on"}}"#), nil, "counts missing")
        },
        Check(name: "poll: up with the parsed reading; GET /healthz first, then /api/shell") {
            let server = try TinyServer { $0 == "/healthz" ? json(#"{"status":"ok"}"#) : json(goodShell) }
            defer { server.shut() }
            let st = try readOnce(Poller(homePort: server.port, timeout: 2))
            try same(st, .up(ShellStatus(needsYou: 3, running: 1, board: .on, books: .notInstalled, gate: .off)))
            let lines = server.requests.map { $0.split(separator: "\r\n").first.map(String.init) ?? "" }
            try same(lines, ["GET /healthz HTTP/1.1", "GET /api/shell HTTP/1.1"], "requests")
            try expect(server.requests.allSatisfy { $0.contains("Host: 127.0.0.1:\(server.port)") }, "Host")
        },
        Check(name: "poll: no cookie is kept or sent") {
            let server = try TinyServer { p in
                var r = p == "/healthz" ? json("{}") : json(goodShell)
                r.headers.append("Set-Cookie: s=1; Path=/")
                return r
            }
            defer { server.shut() }
            let poller = Poller(homePort: server.port, timeout: 2)
            _ = try readOnce(poller)
            _ = try readOnce(poller)
            try same(server.requests.count, 4, "requests")
            try expect(!server.requests.contains { $0.lowercased().contains("\r\ncookie:") }, "a cookie was sent")
        },
        Check(name: "poll: /api/shell unreadable or not 200 is answering") {
            let server = try TinyServer { $0 == "/healthz" ? json("{}") : json(#"{"counts":{"needsYou":"3"}}"#) }
            defer { server.shut() }
            let poller = Poller(homePort: server.port, timeout: 2)
            try same(try readOnce(poller), .answering, "unreadable")
            server.route = { $0 == "/healthz" ? json("{}") : TinyServer.Reply(status: 404) }
            try same(try readOnce(poller), .answering, "404")
            server.route = { $0 == "/healthz" ? json("{}") : TinyServer.Reply(status: 500, body: Data(goodShell.utf8)) }
            try same(try readOnce(poller), .answering, "500 with a good body")
        },
        Check(name: "poll: /healthz not 200, or nothing listening, is down") {
            let server = try TinyServer { _ in TinyServer.Reply(status: 503) }
            let poller = Poller(homePort: server.port, timeout: 2)
            try same(try readOnce(poller), .down, "503")
            server.shut()
            try same(try readOnce(poller), .down, "closed")
        },
        Check(name: "poll: a redirect is never followed and is down") {
            var port = 0
            let server = try TinyServer { p in
                switch p {
                case "/healthz": return json("{}")
                case "/api/shell": return TinyServer.Reply(status: 302, headers: ["Location: http://127.0.0.1:\(port)/elsewhere"])
                default: return json(goodShell)
                }
            }
            port = server.port
            defer { server.shut() }
            let poller = Poller(homePort: server.port, timeout: 2)
            try same(try readOnce(poller), .down, "shell redirect")
            server.route = { $0 == "/healthz" ? TinyServer.Reply(status: 301, headers: ["Location: /api/shell"]) : json(goodShell) }
            try same(try readOnce(poller), .down, "healthz redirect")
            try expect(!server.requests.contains { $0.hasPrefix("GET /elsewhere") }, "the redirect was followed")
        },
        Check(name: "poll: a 2 MB body is cut and not read as a reading") {
            var big = Data(#"{"counts":{"needsYou":1,"running":1},"pad":""#.utf8)
            big.append(Data(repeating: UInt8(ascii: "a"), count: 2 * 1024 * 1024))
            big.append(Data(#""}"#.utf8))
            let server = try TinyServer { $0 == "/healthz" ? json("{}") : TinyServer.Reply(body: big) }
            defer { server.shut() }
            let t0 = Date()
            try same(try readOnce(Poller(homePort: server.port, timeout: 3)), .answering, "2 MB")
            try expect(Date().timeIntervalSince(t0) < 3, "too slow")
        },
        Check(name: "poll: a slow answer runs out at the time limit") {
            let server = try TinyServer { p in
                var r = p == "/healthz" ? json("{}") : json(goodShell)
                if p == "/api/shell" { r.delay = 3 }
                return r
            }
            defer { server.shut() }
            let t0 = Date()
            try same(try readOnce(Poller(homePort: server.port, timeout: 1)), .answering, "slow shell")
            try expect(Date().timeIntervalSince(t0) < 2.5, "waited \(Date().timeIntervalSince(t0)) s")
            server.route = { _ in var r = json("{}"); r.delay = 3; return r }
            try same(try readOnce(Poller(homePort: server.port, timeout: 1)), .down, "slow healthz")
        },
        Check(name: "poll: the timer reads on the main run loop until stopped") {
            let server = try TinyServer { $0 == "/healthz" ? json("{}") : json(goodShell) }
            defer { server.shut() }
            let poller = Poller(homePort: server.port, timeout: 2)
            var states: [Poller.State] = []
            var onMain = true
            poller.start(every: 0.25) { st in onMain = onMain && Thread.isMainThread; states.append(st) }
            try expect(spin(5) { states.count >= 3 }, "only \(states.count) readings")
            poller.stop()
            let n = states.count
            _ = spin(0.8) { false }
            try expect(states.count <= n + 1, "readings went on after stop")
            try expect(onMain, "a reading arrived off the main thread")
            try expect(states.allSatisfy { if case .up = $0 { return true }; return false }, "\(states)")
        },
        Check(name: "poll: every 20 s with the window open, 30 s closed") {
            try same(Poller.interval(windowOpen: true), 20, "open")
            try same(Poller.interval(windowOpen: false), 30, "closed")
        },
    ]
}

// ---- awake: ------------------------------------------------------------------------------------------------

// Whether this process holds an assertion with the app's name, read from the power manager.
private func holdsNamed() -> Bool {
    var raw: Unmanaged<CFDictionary>?
    guard IOPMCopyAssertionsByProcess(&raw) == kIOReturnSuccess,
          let all = raw?.takeRetainedValue() as? [NSNumber: [[String: Any]]] else { return false }
    let mine = all[NSNumber(value: getpid())] ?? []
    return mine.contains { ($0[kIOPMAssertionNameKey] as? String) == KeepAwake.assertionName }
}

private func awakeChecks() -> [Check] {
    let vectors: [((Bool, Int, Bool, Bool, Int), Bool)] = [
        ((true, 2, true, true, 5), true), ((true, 2, true, false, 30), true), ((true, 2, true, false, 29), false),
        ((true, 0, true, true, 100), false), ((false, 2, true, true, 100), false), ((true, 2, false, true, 100), false),
    ]
    var checks = vectors.map { v, want in
        Check(name: "awake: hold\(v) -> \(want)") {
            try same(KeepAwake.hold(engineOn: v.0, running: v.1, switchOn: v.2, onMains: v.3, battery: v.4), want)
        }
    }
    let up = { (n: Int) in Poller.State.up(ShellStatus(needsYou: 0, running: n, board: .on, books: .on, gate: .on)) }
    checks += [
        Check(name: "awake: dropped after two readings in a row with nothing running") {
            var rule = AwakeRule()
            var held = rule.next(up(2), switchOn: true, onMains: true, battery: 100, holding: false)
            try same(held, true, "running")
            held = rule.next(up(0), switchOn: true, onMains: true, battery: 100, holding: held)
            try same(held, true, "first idle reading")
            held = rule.next(up(0), switchOn: true, onMains: true, battery: 100, holding: held)
            try same(held, false, "second idle reading")
            held = rule.next(up(0), switchOn: true, onMains: true, battery: 100, holding: held)
            try same(held, false, "third idle reading")
            held = rule.next(up(1), switchOn: true, onMains: true, battery: 100, holding: held)
            try same(held, true, "running again")
        },
        Check(name: "awake: an idle reading never takes it when not held") {
            var rule = AwakeRule()
            try same(rule.next(up(0), switchOn: true, onMains: true, battery: 100, holding: false), false)
        },
        Check(name: "awake: dropped at once when the reading fails, the switch goes off, or the battery is low") {
            var rule = AwakeRule()
            for bad in [Poller.State.down, .answering] {
                _ = rule.next(up(1), switchOn: true, onMains: true, battery: 100, holding: false)
                try same(rule.next(bad, switchOn: true, onMains: true, battery: 100, holding: true), false, "\(bad)")
            }
            try same(rule.next(up(1), switchOn: false, onMains: true, battery: 100, holding: true), false, "switch off")
            try same(rule.next(up(1), switchOn: true, onMains: false, battery: 20, holding: true), false, "battery 20")
            try same(rule.next(up(0), switchOn: true, onMains: false, battery: 20, holding: true), false, "idle, battery 20")
        },
        Check(name: "awake: the assertion is taken and let go (seen by the power manager)") {
            let k = KeepAwake()
            try expect(!holdsNamed(), "held before")
            try same(k.set(true), true, "set(true)")
            try expect(holdsNamed(), "the power manager does not list it")
            try same(k.set(true), true, "set(true) twice")
            try same(k.set(false), false, "set(false)")
            try expect(!holdsNamed(), "still listed after set(false)")
        },
        Check(name: "awake: let go when the holder goes (as on quit)") {
            do {
                let k = KeepAwake()
                k.set(true)
                try expect(holdsNamed(), "not taken")
            }
            try expect(!holdsNamed(), "still listed after the holder went")
        },
        Check(name: "awake: the power reading is in range") {
            let p = KeepAwake.power()
            try expect((0...100).contains(p.battery), "battery \(p.battery)")
        },
    ]
    return checks
}

// ---- badge: and notify: ------------------------------------------------------------------------------------

private func badgeChecks() -> [Check] {
    let vectors: [(Int?, String?)] = [(0, nil), (1, "1"), (99, "99"), (100, "99+"), (nil, nil), (-3, nil), (100_000, "99+")]
    return vectors.map { n, want in
        Check(name: "badge: \(n.map(String.init) ?? "nil") -> \(want ?? "nil")") { try same(Badge.text(n), want) }
    }
}

private func notifyChecks() -> [Check] {
    let vectors: [(Int?, Int, String?)] = [
        (nil, 3, nil), (2, 2, nil), (5, 2, nil), (2, 3, "1 new item needs you"), (2, 5, "3 new items need you"),
        (0, 1, "1 new item needs you"), (nil, 0, nil),
    ]
    return vectors.map { p, n, want in
        Check(name: "notify: (\(p.map(String.init) ?? "nil"), \(n)) -> \(want ?? "nil")") {
            try same(Notifier.words(previous: p, now: n), want)
        }
    }
}
