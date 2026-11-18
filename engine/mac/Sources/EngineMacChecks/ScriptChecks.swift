import Foundation

// M16: the scripts around the build (M15's M3, L3 and L6). Each case copies the script under test into a
// fresh scratch folder under the temp folder (a git repository of its own where the script needs one) and runs
// the copy; the real repository is never touched, and build.sh is only ever run in --dev mode, where every
// case here stops before it builds anything.

private struct ScriptFailure: Error, CustomStringConvertible { let description: String }

private func expect(_ ok: Bool, _ why: @autoclosure () -> String) throws {
    if !ok { throw ScriptFailure(description: why()) }
}

/// This folder (engine/mac), found from this file's own path.
private let macFolder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent()

private struct Ran { let code: Int32; let out: String; let err: String }

/// Runs `exe args` in `cwd` with a small fixed environment: no global or system git setting reaches it.
private func run(_ exe: String, _ args: [String], in cwd: URL, home: URL) throws -> Ran {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    p.currentDirectoryURL = cwd
    p.environment = ["PATH": "/usr/bin:/bin", "HOME": home.path, "GIT_CONFIG_NOSYSTEM": "1",
                     "GIT_CONFIG_GLOBAL": "/dev/null", "LANG": "en_US.UTF-8"]
    let out = Pipe(), err = Pipe()
    p.standardOutput = out
    p.standardError = err
    p.standardInput = FileHandle.nullDevice
    try p.run()
    let o = out.fileHandleForReading.readDataToEndOfFile()
    let e = err.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return Ran(code: p.terminationStatus, out: String(decoding: o, as: UTF8.self), err: String(decoding: e, as: UTF8.self))
}

/// A scratch folder that removes itself.
private final class Scratch {
    let dir: URL
    init() throws {
        dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("engine-mac-scripts-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
    deinit { try? FileManager.default.removeItem(at: dir) }

    func write(_ rel: String, _ text: String) throws {
        let url = dir.appendingPathComponent(rel)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: url)
    }

    func copy(_ name: String, to rel: String? = nil) throws {
        let to = dir.appendingPathComponent(rel ?? name)
        try FileManager.default.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: macFolder.appendingPathComponent(name), to: to)
    }

    /// A symbolic link at `rel` holding `target` as written.
    func link(_ rel: String, to target: String) throws {
        let url = dir.appendingPathComponent(rel)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: url.path, withDestinationPath: target)
    }

    func git(_ args: String...) throws {
        let r = try run("/usr/bin/git", ["-c", "user.name=checks", "-c", "user.email=checks@example.invalid",
                                          "-c", "commit.gpgsign=false"] + args, in: dir, home: dir)
        try expect(r.code == 0, "git \(args.joined(separator: " ")): \(r.err)")
    }
}

// ---- version-rule.sh ---------------------------------------------------------------------------------------

/// A repository holding a copy of version-rule.sh, this folder's .gitignore, VERSION 1.0.9 and Sources/a.swift,
/// all committed.
private func versionRepo() throws -> Scratch {
    let s = try Scratch()
    try s.copy("version-rule.sh")
    try s.copy(".gitignore")
    try s.write("VERSION", "1.0.9\n")
    try s.write("Sources/a.swift", "let a = 1\n")
    try s.git("init", "-q")
    try s.git("add", "-A")
    try s.git("commit", "-q", "-m", "start")
    return s
}

private func rule(_ s: Scratch, fromRoot: Bool = false) throws -> Int32 {
    let script = s.dir.appendingPathComponent("version-rule.sh").path
    return try run("/bin/bash", [script], in: fromRoot ? URL(fileURLWithPath: "/") : s.dir, home: s.dir).code
}

private func versionCase(_ label: String, _ want: Int32, _ setUp: @escaping (Scratch) throws -> Void) -> Check {
    Check(name: "version-rule: \(label) -> \(want)") {
        let s = try versionRepo()
        try setUp(s)
        let here = try rule(s), fromRoot = try rule(s, fromRoot: true)
        try expect(here == want, "exit \(here)")
        try expect(fromRoot == want, "exit \(fromRoot) when run from / by full path")
    }
}

private func versionChecks() -> [Check] {
    let edit: (Scratch) throws -> Void = { try $0.write("Sources/a.swift", "let a = 2\n") }
    return [
        // The plan's vectors (PLAN-MAC-2, version-rule.sh).
        versionCase("nothing changed", 0) { _ in },
        versionCase("Sources/a.swift edited, not committed", 1, edit),
        versionCase("the same, and VERSION raised, not committed", 0) { try edit($0); try $0.write("VERSION", "1.0.10\n") },
        versionCase("a Sources change committed alone", 1) { try edit($0); try $0.git("commit", "-qam", "src") },
        versionCase("a new untracked Sources/b.swift", 1) { try $0.write("Sources/b.swift", "let b = 1\n") },
        versionCase("only the generated BuildConstants.swift", 0) {
            try $0.write("Sources/EngineShell/Build/BuildConstants.swift", "public enum BuildConstants {}\n")
        },
        // M15's M3: a file the ignore rules hide is still a change, and an ignored file anywhere else fails.
        versionCase("a planted Sources/CompanyEngine/out/BuildConstants.swift", 1) {
            try $0.write("Sources/CompanyEngine/out/BuildConstants.swift", "let evil = 1\n")
        },
        versionCase("a planted Sources/CompanyEngine/.build/x.swift", 1) {
            try $0.write("Sources/CompanyEngine/.build/x.swift", "let evil = 1\n")
        },
        versionCase("a file ignored by .git/info/exclude, even with VERSION raised", 1) {
            try $0.write(".git/info/exclude", "Sources/hidden.swift\n")
            try $0.write("Sources/hidden.swift", "let evil = 1\n")
            try $0.write("VERSION", "1.0.10\n")
        },
        versionCase("BuildConstants.swift by name in another folder, with VERSION raised", 0) {
            // Not ignored any more, so it shows in git status and the source rules read it (see source-rules).
            try $0.write("Sources/CompanyEngine/BuildConstants.swift", "let x = 1\n")
            try $0.write("VERSION", "1.0.10\n")
        },
        // M15's L3: VERSION content that is not a new version.
        versionCase("Sources edited, VERSION with a trailing space", 1) { try edit($0); try $0.write("VERSION", "1.0.9 \n") },
        versionCase("Sources edited, VERSION with a second line", 1) { try edit($0); try $0.write("VERSION", "1.0.9\n2.0.0\n") },
        versionCase("Sources edited, VERSION lowered", 1) { try edit($0); try $0.write("VERSION", "0.9.0\n") },
        versionCase("Sources edited, VERSION 1.0.9.0 (not higher)", 1) { try edit($0); try $0.write("VERSION", "1.0.9.0\n") },
        versionCase("Sources edited, VERSION holding code", 1) {
            try edit($0); try $0.write("VERSION", "1.0\"+String(7*6)+\"\n")
        },
        versionCase("Sources edited, VERSION 1.1 (higher, fewer parts)", 0) { try edit($0); try $0.write("VERSION", "1.1\n") },
        versionCase("Sources edited, VERSION 2.0.0.1", 0) { try edit($0); try $0.write("VERSION", "2.0.0.1\n") },
        versionCase("nothing changed, VERSION not a version", 1) { try $0.write("VERSION", "1.0.9 \n") },
        versionCase("nothing changed, VERSION with no line end", 0) { try $0.write("VERSION", "1.0.9") },
        // M16b (the second look at M16): a link SwiftPM compiles but grep does not follow, files git is told not to
        // look at, a VERSION lowered with nothing else changed, and a part too long to compare.
        versionCase("a committed link under Sources to an ignored file, VERSION raised and committed", 1) {
            try $0.write("out/evil.swift", "let evil = 1\n")
            try $0.link("Sources/Link.swift", to: "../out/evil.swift")
            try $0.write("VERSION", "1.0.10\n")
            try $0.git("add", "-A")
            try $0.git("commit", "-qm", "link")
        },
        versionCase("an edit hidden by skip-worktree", 1) {
            try $0.git("update-index", "--skip-worktree", "Sources/a.swift")
            try $0.write("Sources/a.swift", "let evil = 1\n")
        },
        versionCase("an edit hidden by assume-unchanged", 1) {
            try $0.git("update-index", "--assume-unchanged", "Sources/a.swift")
            try $0.write("Sources/a.swift", "let evil = 1\n")
        },
        versionCase("nothing changed under Sources, VERSION lowered", 1) { try $0.write("VERSION", "1.0.8\n") },
        versionCase("nothing changed under Sources, VERSION raised", 0) { try $0.write("VERSION", "1.0.10\n") },
        versionCase("Sources edited, VERSION with a part of ten digits", 1) {
            try edit($0); try $0.write("VERSION", "1.0.9999999999\n")
        },
        versionCase("Sources edited, VERSION with parts of nine digits", 0) {
            try edit($0); try $0.write("VERSION", "1.0.999999999\n")
        },
        versionCase("the generated BuildConstants.swift committed by force", 1) {
            try $0.write("Sources/EngineShell/Build/BuildConstants.swift", "let evil = 1\n")
            try $0.write("VERSION", "1.0.10\n")
            try $0.git("add", "-f", "-A")
            try $0.git("commit", "-qm", "forced")
        },
    ]
}

// ---- source-rules.sh (the forbidden words, M15's M3 and L6) ------------------------------------------------

private func sourceCase(_ label: String, _ want: Int32, _ files: [(String, String)],
                        links: [(String, String)] = []) -> Check {
    Check(name: "source-rules: \(label) -> \(want)") {
        let s = try Scratch()
        try s.copy("source-rules.sh")
        try s.write("Sources/EngineShell/Web/HomeOrigin.swift", "let host = \"127.0.0.1\"\n")
        try s.write("Sources/CompanyEngine/App.swift", "let ok = 1\n")
        for (path, text) in files { try s.write(path, text) }
        for (path, target) in links { try s.link(path, to: target) }
        let r = try run("/bin/bash", [s.dir.appendingPathComponent("source-rules.sh").path], in: URL(fileURLWithPath: "/"), home: s.dir)
        try expect(r.code == want, "exit \(r.code): \(r.err.prefix(300))")
    }
}

private func sourceRuleChecks() -> [Check] {
    [
        sourceCase("clean sources", 0, []),
        sourceCase("the generated file in its own place", 0, [
            ("Sources/EngineShell/Build/BuildConstants.swift", "public static let engineRoot = \"/Users/x/secrets-free\"\n"),
        ]),
        sourceCase("a BuildConstants.swift in another folder is read", 1, [
            ("Sources/CompanyEngine/out/BuildConstants.swift", "func f(w: W) { w.evaluateJavaScript(\"1\") }\n"),
        ]),
        sourceCase("loadSimulatedRequest", 1, [
            ("Sources/CompanyEngine/A.swift", "web.loadSimulatedRequest(r, responseHTML: h)\n"),
        ]),
        sourceCase("load(_:mimeType:characterEncodingName:baseURL:)", 1, [
            ("Sources/EngineShell/A.swift", "web.load(d, mimeType: \"text/html\", characterEncodingName: \"utf-8\", baseURL: u)\n"),
        ]),
        sourceCase("loadHTMLString still", 1, [("Sources/EngineShell/A.swift", "web.loadHTMLString(h, baseURL: nil)\n")]),
        sourceCase("a loopback literal outside HomeOrigin.swift", 1, [("Sources/CompanyEngine/B.swift", "let u = \"http://127.0.0.1:3200\"\n")]),
        // M16b: a file is left out by its path, never by a line of grep's output that starts like it.
        sourceCase("a file named BuildConstants.swift:x.swift beside the generated one", 1, [
            ("Sources/EngineShell/Build/BuildConstants.swift:x.swift", "func f(w: W) { w.evaluateJavaScript(\"1\") }\n"),
        ]),
        sourceCase("a file named HomeOrigin.swift:y.swift with the loopback literal", 1, [
            ("Sources/EngineShell/Web/HomeOrigin.swift:y.swift", "let u = \"http://127.0.0.1:3172\"\n"),
        ]),
        sourceCase("a clean file whose name holds a line break", 1, [("Sources/CompanyEngine/a\nb.swift", "let ok = 1\n")]),
        sourceCase("a link under Sources to a file outside them", 1, [("out/evil.swift", "func f(w: W) { w.evaluateJavaScript(\"1\") }\n")],
                   links: [("Sources/EngineShell/Web/Link.swift", "../../../out/evil.swift")]),
        sourceCase("a link under Sources to a clean file", 1, [], links: [("Sources/CompanyEngine/Same.swift", "App.swift")]),
    ]
}

// ---- build.sh and check.sh read VERSION the same way (M15's L3) --------------------------------------------

private func buildVersionCase(_ label: String, _ version: String) -> Check {
    Check(name: "build.sh: --dev refuses VERSION \(label) before it writes anything") {
        let s = try Scratch()
        try s.copy("build.sh", to: "repo/engine/mac/build.sh")
        try s.write("repo/engine/mac/VERSION", version)
        try s.write("repo/engine/mac/Sources/EngineShell/Build/.keep", "")
        let repo = s.dir.appendingPathComponent("repo")
        for args in [["init", "-q"], ["add", "-A"], ["-c", "user.name=checks", "-c", "user.email=checks@example.invalid",
                                                     "-c", "commit.gpgsign=false", "commit", "-qm", "start"]] {
            let g = try run("/usr/bin/git", args, in: repo, home: s.dir)
            try expect(g.code == 0, "git \(args): \(g.err)")
        }
        let out = s.dir.appendingPathComponent("out")
        let r = try run("/bin/bash", [repo.appendingPathComponent("engine/mac/build.sh").path, "--dev", "--origin-port", "34120",
                                      "--out", out.path], in: s.dir, home: s.dir)
        try expect(r.code != 0, "exit 0")
        try expect(r.err.contains("VERSION"), "it did not name VERSION: \(r.err.prefix(200))")
        let constants = repo.appendingPathComponent("engine/mac/Sources/EngineShell/Build/BuildConstants.swift")
        try expect(!FileManager.default.fileExists(atPath: constants.path), "BuildConstants.swift was written")
    }
}

private func buildChecks() -> [Check] {
    var c = [
        buildVersionCase("with a trailing space", "1.0.9 \n"),
        buildVersionCase("with a second line", "1.0.9\nx\n"),
        buildVersionCase("holding code", "1.0\"+String(7*6)+\"\n"),
        buildVersionCase("empty", ""),
        buildVersionCase("with a letter", "1.0.9a\n"),
        buildVersionCase("with a part of ten digits", "1.0.1234567890\n"),
    ]
    c.append(Check(name: "build.sh: --install runs version-rule.sh and source-rules.sh before it builds") {
        let text = try String(contentsOf: macFolder.appendingPathComponent("build.sh"), encoding: .utf8)
        guard let install = text.range(of: "else\n  [ -z \"$PORT\" ]"), let build = text.range(of: "swift build") else {
            throw ScriptFailure(description: "build.sh's install branch not found")
        }
        let branch = text[install.lowerBound..<build.lowerBound]
        try expect(branch.contains("\"$HERE/version-rule.sh\""), "the install branch does not run version-rule.sh")
        try expect(branch.contains("\"$HERE/source-rules.sh\""), "the install branch does not run source-rules.sh")
    })
    c.append(Check(name: "check.sh: reads VERSION as build.sh does, and runs source-rules.sh") {
        let check = try String(contentsOf: macFolder.appendingPathComponent("check.sh"), encoding: .utf8)
        let build = try String(contentsOf: macFolder.appendingPathComponent("build.sh"), encoding: .utf8)
        let pattern = "^[0-9]{1,9}(\\.[0-9]{1,9}){1,3}$"
        for (name, text) in [("check.sh", check), ("build.sh", build),
                             ("version-rule.sh", try String(contentsOf: macFolder.appendingPathComponent("version-rule.sh"), encoding: .utf8))] {
            try expect(text.contains(pattern), "\(name) does not hold the VERSION pattern")
        }
        try expect(check.contains("\"$HERE/source-rules.sh\""), "check.sh does not run source-rules.sh")
        try expect(!check.contains("--exclude=BuildConstants.swift"), "check.sh still leaves files out by name")
    })
    c.append(Check(name: ".gitignore: the build folders are anchored to this folder") {
        let lines = try String(contentsOf: macFolder.appendingPathComponent(".gitignore"), encoding: .utf8)
            .split(separator: "\n").map(String.init)
        try expect(lines.contains("/.build/") && lines.contains("/out/"), "lines \(lines)")
        try expect(!lines.contains(".build/") && !lines.contains("out/"), "an unanchored folder rule is left")
    })
    return c
}

func scriptChecks() -> [Check] {
    versionChecks() + sourceRuleChecks() + buildChecks()
}
