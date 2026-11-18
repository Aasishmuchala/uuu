import Foundation
import EngineShell

// Checks for EngineShell/Native (M5): SafeName and TitleText (4.6) vector by vector, the native words
// (4.7), the Go menu (section 3), the Engine menu's state line, the off page's sentence (D11), the title
// bar's tint (D14) and the VERSION reading (D10).

private struct NativeFailure: Error, CustomStringConvertible { let description: String }

private func expect(_ ok: Bool, _ why: @autoclosure () -> String) throws {
    if !ok { throw NativeFailure(description: why()) }
}

private func show(_ s: String) -> String {
    s.unicodeScalars.map { $0.value < 0x20 || (0x7F...0x9F).contains($0.value) || (0x200E...0x2069).contains($0.value)
        ? String(format: "\\u{%04X}", $0.value) : String($0) }.joined()
}

private func name(_ label: String, _ input: String, _ want: String) -> Check {
    Check(name: "name: \(label) -> \(show(want).prefix(60))") {
        let got = SafeName.clean(input)
        try expect(got == want, "got \(show(got))")
    }
}

private func title(_ label: String, _ input: String, _ want: String) -> Check {
    Check(name: "title: \(label)") {
        let got = TitleText.clean(input)
        try expect(got == want, "got \(show(got)) (\(got.count) characters)")
    }
}

private func nameChecks() -> [Check] {
    let letters300 = String(repeating: "a", count: 300)
    var c: [Check] = [
        name("plain name kept", "report.pdf", "report.pdf"),
        name("climbing path", "../../.ssh/id", "id"),
        name("leading dot", ".env", "env"),
        name("slash, backslash and colon", "a/b\\c:d.zip", "d.zip"),
        name("empty", "", "download"),
        name("only dots", "...", "download"),
        name("one dot", ".", "download"),
        name("300 letters + .png", letters300 + ".png", String(repeating: "a", count: 116) + ".png"),
        name("control characters", "re\u{0}po\u{1B}rt\u{7F}.pdf", "report.pdf"),
        name("line break and tab", "a\nb\tc.txt", "abc.txt"),
        name("right-to-left override hiding .app", "invoice\u{202E}fdp.app", "invoicefdp.app.txt"),
        name("isolates and marks", "x\u{2066}y\u{2069}z\u{200F}.csv", "xyz.csv"),
        name("trailing dot after .app", "tool.app.", "tool.app.txt"),
        name("upper-case .APP", "Setup.APP", "Setup.APP.txt"),
        name("spaces trimmed", "  notes.md  ", "notes.md"),
        name("no extension", "README", "README"),
        name("ending in a slash", "folder/", "download"),
        name("dots and slashes only", "../..", "download"),
    ]
    for ext in ["app", "command", "terminal", "pkg", "dmg", "workflow", "scpt", "sh", "webloc"] {
        c.append(name("runnable .\(ext)", "file.\(ext)", "file.\(ext).txt"))
    }
    c.append(name("300 letters + .sh stays short", letters300 + ".sh", String(repeating: "a", count: 113) + ".sh.txt"))
    c.append(Check(name: "name: never longer than 120, never empty, never hidden characters") {
        let samples = [letters300, letters300 + ".command", "\u{202E}" + letters300 + "." + String(repeating: "x", count: 40),
                       String(repeating: ".", count: 500), "/" + letters300 + "/"]
        for s in samples {
            let got = SafeName.clean(s)
            try expect(!got.isEmpty && got.count <= 120, "\(got.count) characters for a sample")
            try expect(!got.contains("/") && !got.hasPrefix("."), "a separator or a leading dot is left")
            try expect(!got.unicodeScalars.contains { $0.value < 0x20 || (0x202A...0x202E).contains($0.value) }, "a hidden character is left")
        }
    })
    return c
}

private func titleChecks() -> [Check] {
    let long = String(repeating: "t", count: 100)
    return [
        title("plain title kept", "Needs you · Company", "Needs you · Company"),
        title("empty -> app name", "", "Company Engine"),
        title("only spaces -> app name", "   ", "Company Engine"),
        title("only hidden characters -> app name", "\u{0}\u{202E}\u{2066}", "Company Engine"),
        title("100 characters -> 79 + …", long, String(repeating: "t", count: 79) + "…"),
        title("exactly 80 kept", String(repeating: "t", count: 80), String(repeating: "t", count: 80)),
        title("81 cut", String(repeating: "t", count: 81), String(repeating: "t", count: 79) + "…"),
        title("U+0000 to U+001F removed", "a\u{0}b\u{1F}c\nd\te", "abcde"),
        title("U+007F removed", "a\u{7F}b", "ab"),
        title("U+202A to U+202E removed", "a\u{202A}b\u{202B}c\u{202C}d\u{202D}e\u{202E}f", "abcdef"),
        title("U+2066 to U+2069 removed", "a\u{2066}b\u{2067}c\u{2068}d\u{2069}e", "abcde"),
        title("markup stays plain text", "<b>Tasks</b>", "<b>Tasks</b>"),
        Check(name: "title: never over 80 characters") {
            for n in [0, 1, 79, 80, 81, 500, 10_000] {
                let got = TitleText.clean(String(repeating: "é", count: n))
                try expect(got.count <= 80 && !got.isEmpty, "\(got.count) characters for \(n)")
            }
        },
    ]
}

private func wordChecks() -> [Check] {
    let want: [(String, String)] = [
        (NativeWords.appName, "Company Engine"),
        (NativeWords.offTitle, "The engine is off."),
        (NativeWords.offLine, "Start it to open the home screen."),
        (NativeWords.start, "Start the engine"),
        (NativeWords.starting, "Starting the engine. This can take a minute or two."),
        (NativeWords.stopMenu, "Stop the engine…"),
        (NativeWords.stopTitle, "Turn the engine off?"),
        (NativeWords.stopBody, "Agents that are working will stop. Nothing is lost; start the engine to carry on."),
        (NativeWords.stopConfirm, "Turn off"),
        (NativeWords.stopCancel, "Cancel"),
        (EngineWords.devBuild, "This is a development build. It cannot start or stop the engine."),
        (EngineWords.busy, "The engine is already being started or stopped. Wait for it to finish."),
        (EngineWords.badRoot, "This app cannot find the engine it was built for. Rebuild it: engine/mac/build.sh --install"),
        (NativeWords.stale, "A newer version of this app is in the repository. Run: engine/mac/build.sh --install"),
        (NativeWords.pageMessageHeading, "The home screen says"),
        (NativeWords.engineOn, "Engine: on"),
        (NativeWords.engineOff, "Engine: off"),
        (NativeWords.engineAttention, "Engine: needs attention"),
        (NativeWords.needsYou(4), "Needs you: 4"),
        (NativeWords.nothingNeedsYou, "Nothing needs you"),
        (NativeWords.keepAwake, "Keep the Mac awake while agents work"),
        (NativeWords.keepAwakeNote, "A closed lid still puts the Mac to sleep."),
        (NativeWords.notifyMe, "Notify me when something needs me"),
        (NativeWords.openAtLogin, "Open Company Engine at login"),
        (NativeWords.notAnswering, "The home screen is not answering. Stop the engine, then start it."),
        (NativeWords.notificationTitle, "Company Engine"),
    ]
    return [Check(name: "words: W1 to W17 exactly as 4.7 (\(want.count) sentences)") {
        for (got, w) in want { try expect(got == w, "\"\(got)\" is not \"\(w)\"") }
    }]
}

private let home = HomeOrigin.local(port: 3200)

private func goChecks() -> [Check] {
    var c: [Check] = []
    let want = [("Map", "1", "map"), ("Needs you", "2", "needs-you"), ("Tasks", "3", "tasks"),
                ("Dashboards", "4", "dashboards"), ("Files", "5", "files"), ("Jobs", "6", "jobs")]
    c.append(Check(name: "go: six pages on Cmd-1 to Cmd-6, in section 3's order, nothing for the Brain") {
        try expect(GoRoute.all.count == 6, "\(GoRoute.all.count) items")
        for (route, w) in zip(GoRoute.all, want) {
            try expect(route.title == w.0 && route.key == w.1 && route.path == "/#/\(w.2)", "\(route.title) is wrong")
        }
        try expect(!GoRoute.all.contains { $0.path.contains("brain") }, "a Brain item")
    })
    let paths = GoRoute.all.map(\.path) + [GoRoute.settings, GoRoute.health, GoRoute.needsYou, GoRoute.home]
    for path in paths {
        c.append(Check(name: "go: \(path) is an address of the home screen") {
            guard let url = home.url(path) else { throw NativeFailure(description: "no address") }
            try expect(NavigationPolicy(home: home).isHome(url), "not the home origin: \(url)")
            try expect(url.absoluteString == "http://\(HomeOrigin.loopbackHost):3200\(path)", "built \(url)")
        })
    }
    return c
}

private func status(_ needs: Int, _ board: PartState, _ gate: PartState) -> Poller.State {
    .up(ShellStatus(needsYou: needs, running: 0, board: board, books: .notInstalled, gate: gate))
}

private func lineChecks() -> [Check] {
    let cases: [(String, Poller.State, String, String?)] = [
        ("board and gate on", status(0, .on, .on), "Engine: on", "Nothing needs you"),
        ("board off", status(3, .off, .on), "Engine: needs attention", "Needs you: 3"),
        ("gate not installed", status(1, .on, .notInstalled), "Engine: needs attention", "Needs you: 1"),
        ("board unknown", status(0, .unknown, .on), "Engine: needs attention", "Nothing needs you"),
        ("answering, unreadable", .answering, "Engine: needs attention", nil),
        ("down", .down, "Engine: off", nil),
    ]
    return cases.map { label, state, w13, w14 in
        Check(name: "line: \(label) -> \(w13)") {
            try expect(EngineLine.text(state) == w13, "got \(EngineLine.text(state))")
            try expect(EngineLine.needsYou(state) == w14, "W14 got \(EngineLine.needsYou(state) ?? "nil")")
        }
    }
}

private func offPageChecks() -> [Check] {
    func off(_ label: String, _ state: SwitchState, starting: Bool, notAnswering: Bool, note: String?, enabled: Bool) -> Check {
        Check(name: "offpage: \(label)") {
            let t = OffPageText.make(state, starting: starting, notAnswering: notAnswering)
            try expect(t.title == "The engine is off." && t.line == "Start it to open the home screen.", "title or line")
            try expect(t.note == note, "note \(t.note ?? "nil")")
            try expect(t.startEnabled == enabled, "start enabled \(t.startEnabled)")
        }
    }
    return [
        off("a development build shows W8, Start off", .unavailable(EngineWords.devBuild), starting: false, notAnswering: false,
            note: EngineWords.devBuild, enabled: false),
        off("a bad root shows W10, Start off", .unavailable(EngineWords.badRoot), starting: false, notAnswering: true,
            note: EngineWords.badRoot, enabled: false),
        off("starting shows W5, Start off", .ready, starting: true, notAnswering: true, note: NativeWords.starting, enabled: false),
        off("answering but not loading shows W16", .ready, starting: false, notAnswering: true, note: NativeWords.notAnswering, enabled: true),
        off("ready shows no note, Start on", .ready, starting: false, notAnswering: false, note: nil, enabled: true),
    ]
}

private func tintChecks() -> [Check] {
    let cases: [(String, Double, Double, Double, Bool)] = [
        ("black", 0, 0, 0, true), ("white", 1, 1, 1, false),
        ("dark theme ground #0E0F12", 14 / 255, 15 / 255, 18 / 255, true),
        ("light theme ground #F5F5F0", 245 / 255, 245 / 255, 240 / 255, false),
        ("dark grey #666666", 102 / 255, 102 / 255, 102 / 255, true),
        ("light grey #BBBBBB", 187 / 255, 187 / 255, 187 / 255, false),
        ("out of range is clamped", -1, 2, -5, false),
    ]
    return cases.map { label, r, g, b, dark in
        Check(name: "tint: \(label) -> \(dark ? "dark" : "light")") {
            try expect(TitleTint.isDark(red: r, green: g, blue: b) == dark, "wrong look")
        }
    }
}

private func versionChecks() -> [Check] {
    func line(_ label: String, _ text: String, _ want: String?) -> Check {
        Check(name: "version: \(label) -> \(want ?? "nil")") {
            try expect(VersionFile.firstLine(Data(text.utf8)) == want, "got \(VersionFile.firstLine(Data(text.utf8)) ?? "nil")")
        }
    }
    var c = [
        line("one line", "1.0.2\n", "1.0.2"),
        line("no newline", "1.0.2", "1.0.2"),
        line("spaces around", "  1.0.3 \r\n", "1.0.3"),
        line("second line ignored", "1.0.1\nwhatever", "1.0.1"),
        line("empty", "", nil),
        line("words", "rebuild now", nil),
        line("markup", "<b>1</b>", nil),
    ]
    c.append(Check(name: "version: read from <root>/engine/mac/VERSION; stale only when it differs") {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("m5-version-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        let mac = root.appendingPathComponent("engine/mac")
        try fm.createDirectory(at: mac, withIntermediateDirectories: true)
        try Data("1.0.2\n".utf8).write(to: mac.appendingPathComponent("VERSION"))
        try expect(VersionFile.read(root: root.path) == "1.0.2", "not read")
        try expect(!VersionFile.isStale(compiled: "1.0.2", root: root.path), "same version called stale")
        try expect(VersionFile.isStale(compiled: "1.0.1", root: root.path), "older build not called stale")
        try expect(!VersionFile.isStale(compiled: "1.0.1", root: root.path + "/nowhere"), "a missing file called stale")
        try expect(!VersionFile.isStale(compiled: "1.0.1", root: ""), "an empty root called stale")
        try expect(VersionFile.read(root: "relative/path") == nil, "a relative root was read")
    })
    return c
}

func nativeChecks() -> [Check] {
    nameChecks() + titleChecks() + wordChecks() + goChecks() + lineChecks() + offPageChecks() + tintChecks() + versionChecks()
}
