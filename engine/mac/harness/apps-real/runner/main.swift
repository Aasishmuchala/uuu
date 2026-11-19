// apps-real-runner (PLAN-DESKTOP T2): the seeded test home's App Studio page, with a real app in its frame, in the Mac
// app's own web view, driven by a list of steps, then a JSON report. A test tool, built by harness/apps-real/run.mjs
// with swiftc from EngineShell's sources and this file into one program under .build/; never in the app bundle. It
// may run script in a page, as the probe does (S3 binds the app).
//
// The web view is WebViewFactory.make(home: .local(port: <home>), role: .probe): the app's configuration, guard and
// rule list, untouched. The apps listen on 3188 and 3189, inside NavigationPolicy.appPorts, so nothing stands in for
// anything. Two things are this runner's own:
//  1. the guard's panels: an open panel is answered with the --upload file (so an upload goes all the way through),
//     a save panel with a file in --download-dir (so a download completes); each is recorded, the save panel with the
//     name WebKit suggested and that name after SafeName.clean (what the app's real panel shows);
//  2. a recorder in every frame (console errors, uncaught errors, policy violations, failed loads and fetches, by
//     origin), whose first message also tells the runner which frame is the app's.
// Input is real: mouse clicks and drags are NSEvents handed to the web view under the point, keys are NSEvents through
// the path the app's window takes (performKeyEquivalent for a Command key, then sendEvent), and Copy is the Edit menu's
// copy: sent to the web view. The window is far off every screen and says it is key; the app is never activated.
//
// usage: apps-real-runner --home-port H --path '/?theme=dark#/apps/<slug>' --steps steps.json --json out.json
//          [--size 1280x900] [--appearance light|dark] [--upload file] [--download-dir dir] [--timeout-ms n]
// A step: { "do": "js" | "waitFor" | "click" | "drag" | "key" | "action" | "wait" | "snapshot" | "pasteboard" | "frameState", ... }
// (run.mjs writes them; see checks.mjs). Exit 0 when the report was written, 1 when the page never loaded, 2 bad
// arguments, 3 timed out.
import AppKit
import WebKit

struct Options {
    var homePort = 0
    var path = "/"
    var steps = ""
    var json = ""
    var width = 1280
    var height = 900
    var appearance: String?
    var upload: String?
    var downloadDir: String?
    var timeoutMs = 240_000
}

func fail(_ words: String) -> Never {
    FileHandle.standardError.write(Data("apps-real-runner: \(words)\n".utf8))
    exit(2)
}

func portAllowed(_ p: Int) -> Bool { (3300...65535).contains(p) && ![5000, 5432, 7000, 8120].contains(p) }

func parse(_ argv: [String]) -> Options {
    var o = Options()
    var i = 0
    func value() -> String { i += 1; guard i < argv.count else { fail("\(argv[i - 1]) needs a value") }; return argv[i] }
    while i < argv.count {
        switch argv[i] {
        case "--home-port": o.homePort = Int(value()) ?? 0
        case "--path": o.path = value()
        case "--steps": o.steps = value()
        case "--json": o.json = value()
        case "--size":
            let p = value().split(separator: "x").compactMap { Int($0) }
            guard p.count == 2 else { fail("--size is WxH") }
            o.width = p[0]; o.height = p[1]
        case "--appearance": o.appearance = value()
        case "--upload": o.upload = value()
        case "--download-dir": o.downloadDir = value()
        case "--timeout-ms": o.timeoutMs = Int(value()) ?? 240_000
        default: fail("unknown argument \(argv[i])")
        }
        i += 1
    }
    guard portAllowed(o.homePort) else { fail("the home port must be 3300 to 65535") }
    guard !o.steps.isEmpty, !o.json.isEmpty else { fail("--steps and --json are needed") }
    return o
}

/// The pasteboard as it was before the run, put back after it (and on a time-out).
nonisolated(unsafe) var savedPasteboard: [[(NSPasteboard.PasteboardType, Data)]]?
func savePasteboard() -> [[(NSPasteboard.PasteboardType, Data)]] {
    (NSPasteboard.general.pasteboardItems ?? []).map { item in item.types.compactMap { t in item.data(forType: t).map { (t, $0) } } }
}
func restorePasteboard(_ saved: [[(NSPasteboard.PasteboardType, Data)]]) {
    let pb = NSPasteboard.general
    pb.clearContents()
    let items: [NSPasteboardItem] = saved.map { types in
        let item = NSPasteboardItem()
        for (t, d) in types { item.setData(d, forType: t) }
        return item
    }
    if !items.isEmpty { pb.writeObjects(items) }
}

/// The runner's panels: what was asked, with the names a save panel would show.
@MainActor
final class RunnerPanels: WebPanels {
    var asked: [[String: Any]] = []
    let upload: String?
    let downloadDir: String?
    init(upload: String?, downloadDir: String?) { self.upload = upload; self.downloadDir = downloadDir }
    func chooseFiles(multiple: Bool, directories: Bool, completion: @escaping @MainActor ([URL]?) -> Void) {
        asked.append(["panel": "open", "multiple": multiple, "answered": upload ?? NSNull()])
        completion(upload.map { [URL(fileURLWithPath: $0)] })
    }
    func chooseSaveLocation(suggestedName: String, completion: @escaping @MainActor (URL?) -> Void) {
        let clean = SafeName.clean(suggestedName)
        var to: URL?
        if let d = downloadDir { to = URL(fileURLWithPath: d).appendingPathComponent("\(asked.count)-\(clean)") }
        asked.append(["panel": "save", "suggested": suggestedName, "cleaned": clean, "to": to?.path ?? NSNull()])
        completion(to)
    }
    func showPageMessage(_ text: String, confirm: Bool, completion: @escaping @MainActor (Bool) -> Void) {
        asked.append(["panel": confirm ? "confirm" : "alert", "text": String(text.prefix(200))])
        completion(false)
    }
}

/// A window that says it is the key window without the app ever becoming active (the runner never takes the screen
/// or the keyboard from the owner): WebKit reads isKeyWindow for the page's focused-and-active state, which decides
/// whether a click moves the focus into a frame and where a key goes, as in the app's own key window.
final class KeyWindow: NSWindow {
    override var isKeyWindow: Bool { true }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Every frame's recorder messages, by origin; and the newest frame of each app origin.
final class Sink: NSObject, WKScriptMessageHandler {
    var byOrigin: [String: [String: [String]]] = [:]
    var frames: [Int: WKFrameInfo] = [:]
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let kind = body["k"] as? String else { return }
        let o = message.frameInfo.securityOrigin
        if kind == "hello" {
            if !message.frameInfo.isMainFrame, o.host == "127.0.0.1" { frames[o.port] = message.frameInfo }
            return
        }
        let text = (body["t"] as? String) ?? ""
        let key = "\(o.protocol)://\(o.host):\(o.port)"
        var entry = byOrigin[key] ?? [:]
        var list = entry[kind] ?? []
        if list.count < 200 { list.append(text) }
        entry[kind] = list
        byOrigin[key] = entry
    }
}

let recorder = #"""
(() => {
  const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.appsreal;
  const post = (k, t) => { try { h.postMessage({ k, t: String(t).slice(0, 500) }); } catch (e) {} };
  const word = (x) => { try { return x instanceof Error ? (x.stack || x.message) : (typeof x === "object" ? JSON.stringify(x) : String(x)); } catch (e) { return String(x); } };
  post("hello", location.href);
  addEventListener("DOMContentLoaded", () => post("hello", location.href));
  const oe = console.error;
  console.error = function (...a) { post("console", a.map(word).join(" ")); return oe.apply(this, a); };
  const ow = console.warn;
  console.warn = function (...a) { post("warn", a.map(word).join(" ")); return ow.apply(this, a); };
  addEventListener("error", (e) => {
    if (e instanceof ErrorEvent) { post("console", `${e.message} (${e.filename || "?"}:${e.lineno || 0})`); return; }
    const el = e.target;
    if (el && el !== window) post("failed", `${(el.tagName || "?").toLowerCase()} ${el.currentSrc || el.src || el.href || ""}`);
  }, true);
  addEventListener("unhandledrejection", (e) => post("console", `unhandled rejection: ${word(e.reason)}`));
  document.addEventListener("securitypolicyviolation", (e) => post("csp", `${e.effectiveDirective || e.violatedDirective} ${e.blockedURI}`), true);
  const f = window.fetch;
  if (f) window.fetch = function (...a) {
    const what = (a[0] && a[0].url) || a[0];
    return f.apply(this, a).then((r) => { if (r.status >= 400) post("failed", `${r.status} ${r.url || what}`); return r; },
      (err) => { if (!(err && err.name === "AbortError")) post("failed", `fetch ${what}: ${word(err)}`); throw err; });
  };
})();
"""#

/// Key names to macOS virtual key codes and the characters a key event carries.
let keyCodes: [String: (UInt16, String)] = [
    "a": (0, "a"), "s": (1, "s"), "d": (2, "d"), "f": (3, "f"), "h": (4, "h"), "g": (5, "g"), "z": (6, "z"), "x": (7, "x"),
    "c": (8, "c"), "v": (9, "v"), "b": (11, "b"), "q": (12, "q"), "w": (13, "w"), "e": (14, "e"), "r": (15, "r"),
    "y": (16, "y"), "t": (17, "t"), "o": (31, "o"), "u": (32, "u"), "i": (34, "i"), "p": (35, "p"), "l": (37, "l"),
    "j": (38, "j"), "k": (40, "k"), "n": (45, "n"), "m": (46, "m"), "/": (44, "/"), "?": (44, "?"), "1": (18, "1"),
    "Enter": (36, "\r"), "Tab": (48, "\t"), "Space": (49, " "), "Escape": (53, "\u{1b}"), "Backspace": (51, "\u{7f}"),
    "ArrowLeft": (123, "\u{F702}"), "ArrowRight": (124, "\u{F703}"), "ArrowDown": (125, "\u{F701}"), "ArrowUp": (126, "\u{F700}"),
]

@MainActor
final class Runner {
    let o: Options
    var web: WKWebView!
    var window: NSWindow!
    let sink = Sink()
    var panels: RunnerPanels!
    var notes: [String] = []
    var results: [String: Any] = [:]
    var log: [[String: Any]] = []

    init(_ o: Options) { self.o = o }

    func sleep(_ ms: Int) async { try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }

    func run(_ body: String, in frame: WKFrameInfo? = nil) async throws -> Any {
        let wrapped = "const __v = await (async () => {\n\(body)\n})(); return JSON.stringify(__v === undefined ? null : __v);"
        let out = try await web.callAsyncJavaScript(wrapped, arguments: [:], in: frame, contentWorld: .page)
        guard let text = out as? String, let data = text.data(using: .utf8) else { return NSNull() }
        return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) ?? NSNull()
    }

    /// The app's frame (the newest frame on 127.0.0.1 that said hello).
    var appFrame: WKFrameInfo? { sink.frames.values.max { a, b in a.securityOrigin.port < b.securityOrigin.port } }

    func target(_ step: [String: Any]) -> WKFrameInfo? { (step["in"] as? String) == "frame" ? appFrame : nil }

    /// Where an element's point is in the web view (top-left based): its box in its frame, plus the frame's offset in
    /// the top page when it is in the app's frame. nil when no element matched.
    func point(_ step: [String: Any], _ prefix: String = "") async -> (Double, Double)? {
        // "selector", "text", "index", "fx", "fy"; with the prefix "to": "toSelector", "toText", ...
        func k(_ name: String) -> String { prefix.isEmpty ? name : prefix + name.prefix(1).uppercased() + name.dropFirst() }
        let sel = (step[k("selector")] as? String) ?? ""
        let text = step[k("text")] as? String
        let index = (step[k("index")] as? Int) ?? 0
        let fx = (step[k("fx")] as? Double) ?? 0.5
        let fy = (step[k("fy")] as? Double) ?? 0.5
        let pair: [Any] = [sel, text.map { $0 as Any } ?? NSNull()]
        let selJS = String(data: try! JSONSerialization.data(withJSONObject: pair, options: [.fragmentsAllowed]), encoding: .utf8)!
        let body = """
        const [sel, text] = \(selJS);
        let list = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        if (text !== null) list = list.filter((e) => ((e.innerText || e.getAttribute("aria-label") || e.value || "").trim().split("\\n")[0].trim() === text) || (e.getAttribute("aria-label") || "") === text);
        // The index-th element the pointer can really reach there: on screen after scrolling, at least 4 points each
        // way, and the topmost thing at that point is it or inside it.
        let seen = 0;
        for (const e of list) {
          e.scrollIntoView({ block: "nearest", inline: "nearest" });
          // A smooth scroll moves the element for a while: wait until it stands still (at most a second).
          let r = e.getBoundingClientRect();
          for (let i = 0; i < 30; i++) {
            await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
            const n = e.getBoundingClientRect();
            if (n.top === r.top && n.left === r.left) break;
            r = n;
          }
          if (r.width < 4 || r.height < 4) continue;
          const x = r.left + r.width * \(fx), y = r.top + r.height * \(fy);
          const hit = document.elementFromPoint(x, y);
          if (!hit || !(hit === e || e.contains(hit))) continue;
          if (seen++ === \(index)) return [x, y];
        }
        return null;
        """
        guard let xy = try? await run(body, in: target(step)) as? [Double], xy.count == 2 else { return nil }
        var x = xy[0], y = xy[1]
        if (step["in"] as? String) == "frame" {
            guard let off = try? await run("const f = document.querySelector('iframe'); if (!f) return null; const r = f.getBoundingClientRect(); return [r.left + f.clientLeft, r.top + f.clientTop];") as? [Double], off.count == 2 else { return nil }
            x += off[0]; y += off[1]
        }
        return (x, y)
    }

    func mouse(_ type: NSEvent.EventType, _ x: Double, _ y: Double, clicks: Int = 1, mods: NSEvent.ModifierFlags = []) {
        let p = NSPoint(x: x, y: Double(web.bounds.height) - y)
        guard let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
                                         windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: clicks,
                                         pressure: type == .leftMouseUp ? 0 : 1) else { return }
        // Straight to the view under the point: on this Mac, NSWindow.sendEvent of a made-up mouse event to a window
        // of an app that is never active reached no page at all (no pointerdown, mousedown or click in any frame).
        let hit = web.hitTest(p)
        switch type {
        case .leftMouseDown: hit?.mouseDown(with: e)
        case .leftMouseUp: hit?.mouseUp(with: e)
        default: hit?.mouseDragged(with: e)
        }
    }

    func modifiers(_ step: [String: Any]) -> NSEvent.ModifierFlags {
        var m: NSEvent.ModifierFlags = []
        for name in (step["mods"] as? [String]) ?? [] {
            switch name {
            case "cmd": m.insert(.command)
            case "shift": m.insert(.shift)
            case "alt": m.insert(.option)
            case "ctrl": m.insert(.control)
            default: break
            }
        }
        return m
    }

    func key(_ step: [String: Any]) -> Bool {
        guard let name = step["key"] as? String, let (code, chars) = keyCodes[name] else { return false }
        let mods = modifiers(step)
        var flags = mods
        if code >= 123 && code <= 126 { flags.insert(.numericPad); flags.insert(.function) }
        let plain = name == "?" ? "/" : chars
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let e = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil, characters: chars,
                                           charactersIgnoringModifiers: plain, isARepeat: false, keyCode: code) else { return false }
            if type == .keyDown && mods.contains(.command) {
                if window.performKeyEquivalent(with: e) { continue }
            }
            window.sendEvent(e)
        }
        return true
    }

    func snapshot(_ path: String) async -> Bool {
        let cfg = WKSnapshotConfiguration()
        cfg.afterScreenUpdates = true
        guard let image = try? await web.takeSnapshot(configuration: cfg), let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else {
            notes.append("no snapshot for \(path)"); return false
        }
        do { try png.write(to: URL(fileURLWithPath: path)) } catch { notes.append("could not write \(path)"); return false }
        return true
    }

    func step(_ s: [String: Any]) async -> [String: Any] {
        let kind = (s["do"] as? String) ?? "?"
        let name = s["as"] as? String
        var out: [String: Any] = ["do": kind]
        if let name { out["as"] = name }
        func keep(_ v: Any) { if let name { results[name] = v } }
        switch kind {
        case "js":
            if (s["in"] as? String) == "frame" && appFrame == nil { out["error"] = "no app frame"; keep(NSNull()); break }
            do { keep(try await run((s["body"] as? String) ?? "", in: target(s))) } catch {
                out["error"] = String(String(describing: error).prefix(300)); keep(["error": out["error"]!])
            }
        case "waitFor":
            let ms = (s["ms"] as? Int) ?? 10_000
            let end = Date().addingTimeInterval(Double(ms) / 1000)
            var ok = false
            while Date() < end {
                if (s["in"] as? String) != "frame" || appFrame != nil,
                   let v = try? await run("return !!(\((s["body"] as? String) ?? "false"))", in: target(s)) as? Bool, v { ok = true; break }
                await sleep(150)
            }
            keep(ok)
            out["ok"] = ok
        case "click":
            guard let (x, y) = await point(s) else { out["error"] = "nothing matched"; keep(false); break }
            let clicks = (s["count"] as? Int) ?? 1
            let mods = modifiers(s)
            for n in 1...clicks {
                mouse(.leftMouseDown, x, y, clicks: n, mods: mods)
                mouse(.leftMouseUp, x, y, clicks: n, mods: mods)
            }
            out["at"] = [x, y]
            keep(true)
        case "drag":
            guard let (x0, y0) = await point(s, "") else { out["error"] = "nothing matched to drag from"; keep(false); break }
            var x1 = x0 + ((s["dx"] as? Double) ?? 0), y1 = y0 + ((s["dy"] as? Double) ?? 0)
            if s["toSelector"] != nil {
                guard let to = await point(s, "to") else { out["error"] = "nothing matched to drag to"; keep(false); break }
                x1 = to.0; y1 = to.1
            }
            let n = (s["steps"] as? Int) ?? 12
            mouse(.leftMouseDown, x0, y0)
            await sleep(60)
            for i in 1...n {
                let t = Double(i) / Double(n)
                mouse(.leftMouseDragged, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
                await sleep(25)
            }
            await sleep(60)
            mouse(.leftMouseUp, x1, y1)
            out["from"] = [x0, y0]; out["to"] = [x1, y1]
            keep(true)
        case "key":
            keep(key(s))
        case "wait":
            await sleep((s["ms"] as? Int) ?? 500)
        case "snapshot":
            keep(await snapshot((s["path"] as? String) ?? "/dev/null"))
        case "action":
            // An Edit menu item as the app's menu sends it: the action to the web view (copy:, selectAll:).
            let sel = Selector((s["name"] as? String) ?? "copy:")
            if web.responds(to: sel) { web.perform(sel, with: nil); keep(true) } else { keep(false) }
        case "pasteboard":
            keep(NSPasteboard.general.string(forType: .string) ?? NSNull())
        case "frameState":
            var st: [String: Any] = ["windowIsKey": window.isKeyWindow, "firstResponderIsWeb": window.firstResponder === web]
            if #available(macOS 13.0, *) { st["fullscreenState"] = web.fullscreenState.rawValue }
            keep(st)
        default:
            out["error"] = "unknown step"
        }
        return out
    }

    func main() async -> Int32 {
        let home = HomeOrigin.local(port: o.homePort)
        guard let url = home.url(o.path) else { fail("--path must start with one /") }
        guard let data = FileManager.default.contents(atPath: o.steps),
              let steps = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { fail("cannot read the steps") }
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)

        web = WebViewFactory.make(home: home, role: .probe)
        guard let guardian = WebViewFactory.webGuard(of: web) else { fail("the factory gave no guard") }
        panels = RunnerPanels(upload: o.upload, downloadDir: o.downloadDir)
        guardian.panels = panels
        let ucc = web.configuration.userContentController
        ucc.add(sink, contentWorld: .page, name: "appsreal")
        ucc.addUserScript(WKUserScript(source: recorder, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        let ruleListOn = WebViewFactory.ruleList(of: web) != nil

        window = KeyWindow(contentRect: NSRect(x: -32000, y: -32000, width: o.width, height: o.height), styleMask: [.borderless],
                           backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        if let a = o.appearance {
            let look = NSAppearance(named: a == "dark" ? .darkAqua : .aqua)
            window.appearance = look
            web.appearance = look
        }
        let occlusion = Selector(("_setWindowOcclusionDetectionEnabled:"))
        if web.responds(to: occlusion), let imp = web.method(for: occlusion) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(imp, to: SetBool.self)(web, occlusion, false)
        }
        window.contentView = web
        web.frame = NSRect(x: 0, y: 0, width: o.width, height: o.height)
        window.orderFrontRegardless()
        window.makeFirstResponder(web)
        NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
        NotificationCenter.default.post(name: NSWindow.didBecomeMainNotification, object: window)

        savedPasteboard = savePasteboard()
        web.load(URLRequest(url: url))
        // The top page loaded and the app's frame said hello.
        let end = Date().addingTimeInterval(30)
        var loaded = false
        while Date() < end {
            if !web.isLoading, let s = try? await run("return document.readyState") as? String, s == "complete" { loaded = true; break }
            await sleep(100)
        }
        if !loaded { notes.append("the page did not load in 30 s") }
        for s in steps where loaded {
            log.append(await step(s))
        }
        if let saved = savedPasteboard { restorePasteboard(saved); savedPasteboard = nil }

        let report: [String: Any] = [
            "url": web.url?.absoluteString ?? "", "loaded": loaded, "ruleListOn": ruleListOn, "windowIsKey": window.isKeyWindow,
            "appFrame": appFrame.map { "\($0.securityOrigin.host):\($0.securityOrigin.port)" } ?? NSNull(),
            "byOrigin": sink.byOrigin, "dropped": guardian.dropped,
            "externalAsked": (guardian.opener as? RecordingOpener)?.asked.map(\.absoluteString) ?? [],
            "panels": panels.asked, "results": results, "steps": log, "notes": notes,
        ]
        let out = (try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
        do { try out.write(to: URL(fileURLWithPath: o.json)) } catch { return 1 }
        window.orderOut(nil)
        return loaded ? 0 : 1
    }
}

let options = parse(Array(CommandLine.arguments.dropFirst()))
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(options.timeoutMs)) {
    if let saved = savedPasteboard { restorePasteboard(saved) }
    FileHandle.standardError.write(Data("apps-real-runner: timed out\n".utf8))
    exit(3)
}
Task { @MainActor in exit(await Runner(options).main()) }
app.run()
