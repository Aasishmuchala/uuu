// frames-trial (PLAN-MAC-2 M8): one load of the frames trial's stand-in home in the app's own web view, then a JSON
// report. A test tool, built by harness/frames/run.mjs with swiftc from EngineShell's sources and this file into one
// program under .build/; never in the app bundle. It may run script in a page, as the probe does (S3 binds the app).
//
// The web view is WebViewFactory.make(home: .local(port: <home>), role: .probe): the app's configuration, guard and
// rule list. Two things are put in place for the trial, and only here, because PLAN-MAC-2 rule 3 keeps App Studio's
// ports 3171 to 3189 unbound and the stand-in app therefore listens on a free port from 3300 up:
//  1. a delegate in front of the guard that judges a load on the stand-in app's origin exactly as the guard judges
//     the same address on port 3175 (the same NavigationPolicy and NavMapping functions), and hands every other
//     callback to the guard itself (Objective-C forwarding: the guard answers alerts, windows, panels, downloads);
//  2. --rules after: the factory's list is replaced by RuleList.json(home:, framePorts: 3171...3189 + the stand-in
//     app's port), compiled by RuleList.compile; --rules before: no list at all (the guard alone, as before M8).
//
// usage: frames-trial --home-port H --app-port A --rules before|after --path '/?...' --json out.json
//          [--click-all] [--settle-ms n] [--astryx] [--snapshot out.png] [--timeout-ms n] [--pasteboard keep|plant]
// --pasteboard: the system's general pasteboard is copied before the load and put back after it (the owner's clipboard
// is never left changed and never written down); `plant` first puts the trial's own text on it, standing for another
// program's, so a read can be told apart. The report says only whose text it held after the load.
import AppKit
import WebKit

struct Options {
    var homePort = 0
    var appPort = 0
    var rules = "after"
    var path = "/"
    var json = ""
    var clickAll = false
    var settleMs = 2500
    var astryx = false
    var snapshot: String?
    var timeoutMs = 120_000
    var pasteboard: String?
}

func fail(_ words: String) -> Never {
    FileHandle.standardError.write(Data("frames-trial: \(words)\n".utf8))
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
        case "--app-port": o.appPort = Int(value()) ?? 0
        case "--rules": o.rules = value()
        case "--path": o.path = value()
        case "--json": o.json = value()
        case "--click-all": o.clickAll = true
        case "--settle-ms": o.settleMs = Int(value()) ?? 2500
        case "--astryx": o.astryx = true
        case "--snapshot": o.snapshot = value()
        case "--timeout-ms": o.timeoutMs = Int(value()) ?? 120_000
        case "--pasteboard": o.pasteboard = value()
        default: fail("unknown argument \(argv[i])")
        }
        i += 1
    }
    guard portAllowed(o.homePort), portAllowed(o.appPort), o.homePort != o.appPort else { fail("ports must be 3300 to 65535") }
    guard o.rules == "before" || o.rules == "after" else { fail("--rules is before or after") }
    guard !o.json.isEmpty else { fail("--json is needed") }
    return o
}

let planted = "frames trial: another program's text"
let framesWrite = "frames trial"

/// What the pasteboard held before a load that changes it, kept so a timed-out run can still put it back.
nonisolated(unsafe) var pendingPasteboard: [[(NSPasteboard.PasteboardType, Data)]]?

/// The general pasteboard's items, every type's bytes, to be put back as they were.
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

/// The stand-in for port 3175: a load on the stand-in app's origin is judged as the same address on an App Studio port.
let standInFor = 3175

final class TrialDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
    let inner: WebGuard
    let appPort: Int
    var appFrames: [WKFrameInfo] = []

    init(inner: WebGuard, appPort: Int) { self.inner = inner; self.appPort = appPort }

    override func responds(to sel: Selector!) -> Bool { super.responds(to: sel) || inner.responds(to: sel) }
    override func forwardingTarget(for sel: Selector!) -> Any? { inner.responds(to: sel) ? inner : nil }

    /// The address with the stand-in app's port written as 3175, when it is on the stand-in app's origin; else nil.
    func asAppStudio(_ url: URL?) -> URL? {
        guard let url, var c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "http",
              c.encodedHost == HomeOrigin.loopbackHost, c.port == appPort, c.percentEncodedUser == nil else { return nil }
        c.port = standInFor
        return c.url
    }

    @MainActor
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        if let target = action.targetFrame, !target.isMainFrame, let mapped = asAppStudio(action.request.url) {
            appFrames.append(target)
            let verdict = inner.policy.decide(NavMapping.request(url: mapped, navigationType: action.navigationType,
                                                                 targetIsMainFrame: false))
            switch NavMapping.outcome(verdict, wantsDownload: action.shouldPerformDownload) {
            case .allow: decisionHandler(.allow)
            case .download: decisionHandler(.download)
            default: decisionHandler(.cancel)
            }
            return
        }
        inner.webView(webView, decidePolicyFor: action, decisionHandler: decisionHandler)
    }

    @MainActor
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        if !response.isForMainFrame, let mapped = asAppStudio(response.response.url) {
            let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
            switch inner.policy.respond(url: mapped, mainFrame: false, canShowMIMEType: response.canShowMIMEType,
                                        contentDisposition: disposition) {
            case .allow: decisionHandler(.allow)
            case .download: decisionHandler(.download)
            case .cancel: decisionHandler(.cancel)
            }
            return
        }
        inner.webView(webView, decidePolicyFor: response, decisionHandler: decisionHandler)
    }
}

/// Records console errors and uncaught errors in every frame, for the Astryx check (page world, every frame).
let recorder = #"""
(() => {
  const e = (window.__trialErrors = []);
  const oe = console.error;
  console.error = function (...a) { try { e.push(a.map(String).join(" ").slice(0, 300)); } catch (x) {} return oe.apply(this, a); };
  addEventListener("error", (ev) => { e.push(ev instanceof ErrorEvent ? `${ev.message}` : `failed ${(ev.target && (ev.target.src || ev.target.href)) || "?"}`); }, true);
  addEventListener("unhandledrejection", (ev) => e.push(`rejection ${String(ev.reason).slice(0, 200)}`));
})();
"""#

@MainActor
final class Trial {
    let o: Options
    var web: WKWebView!
    var window: NSWindow!
    var delegate: TrialDelegate!
    var notes: [String] = []

    init(_ o: Options) { self.o = o }

    func sleep(_ ms: Int) async { try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }

    func run(_ body: String, in frame: WKFrameInfo? = nil) async -> Any? {
        let wrapped = "const __v = await (async () => {\n\(body)\n})(); return JSON.stringify(__v === undefined ? null : __v);"
        guard let out = try? await web.callAsyncJavaScript(wrapped, arguments: [:], in: frame, contentWorld: .page),
              let text = out as? String, let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    var onHome: Bool {
        guard let u = web.url, let c = URLComponents(url: u, resolvingAgainstBaseURL: false) else { return false }
        return c.scheme == "http" && c.encodedHost == HomeOrigin.loopbackHost && c.port == o.homePort
    }

    /// Waits until the top page says `__trial.ready` (the frame answered), at most `ms`.
    func waitReady(_ ms: Int) async -> Bool {
        let end = Date().addingTimeInterval(Double(ms) / 1000)
        while Date() < end {
            if !web.isLoading, onHome, let r = await run("return !!(window.__trial && window.__trial.ready)") as? Bool, r { return true }
            await sleep(100)
        }
        return false
    }

    /// A real mouse click (down and up) at a point of the web view, counted from its top left.
    func click(x: Double, y: Double) {
        let p = NSPoint(x: x, y: Double(web.bounds.height) - y)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let e = NSEvent.mouseEvent(with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                             windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
                                             pressure: type == .leftMouseDown ? 1 : 0) else { continue }
            window.sendEvent(e)
        }
    }

    func snapshot(_ path: String) async {
        let cfg = WKSnapshotConfiguration()
        cfg.afterScreenUpdates = true
        guard let image = try? await web.takeSnapshot(configuration: cfg), let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else {
            notes.append("no snapshot"); return
        }
        do { try png.write(to: URL(fileURLWithPath: path)) } catch { notes.append("could not write the snapshot") }
    }

    func main() async -> Int32 {
        let home = HomeOrigin.local(port: o.homePort)
        guard let url = home.url(o.path) else { fail("--path must start with one /") }
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)

        web = WebViewFactory.make(home: home, role: .probe)
        guard let inner = WebViewFactory.webGuard(of: web) else { fail("the factory gave no guard") }
        let factoryHadList = WebViewFactory.ruleList(of: web) != nil
        let ucc = web.configuration.userContentController
        ucc.removeAllContentRuleLists()
        var rulesOn = false
        if o.rules == "after" {
            let ports = Array(NavigationPolicy.appPorts) + [o.appPort]
            guard let text = RuleList.json(home: home, framePorts: ports),
                  let list = RuleList.compile(text, identifier: "local.uuu.frames-trial.\(o.homePort).\(o.appPort)") else {
                fail("the rule list did not compile")
            }
            ucc.add(list)
            rulesOn = true
        }
        ucc.addUserScript(WKUserScript(source: recorder, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        delegate = TrialDelegate(inner: inner, appPort: o.appPort)
        web.navigationDelegate = delegate
        web.uiDelegate = delegate

        window = NSWindow(contentRect: NSRect(x: -32000, y: -32000, width: 1000, height: 800), styleMask: [.borderless],
                          backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let occlusion = Selector(("_setWindowOcclusionDetectionEnabled:"))
        if web.responds(to: occlusion), let imp = web.method(for: occlusion) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(imp, to: SetBool.self)(web, occlusion, false)
        }
        window.contentView = web
        web.frame = NSRect(x: 0, y: 0, width: 1000, height: 800)
        window.orderFrontRegardless()

        var savedPasteboard: [[(NSPasteboard.PasteboardType, Data)]]?
        if let mode = o.pasteboard {
            savedPasteboard = savePasteboard()
            pendingPasteboard = savedPasteboard
            if mode == "plant" { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(planted, forType: .string) }
        }
        web.load(URLRequest(url: url))
        let ready = await waitReady(30_000)
        if !ready { notes.append("the frame did not answer in 30 s") }

        var clicked: [[String: Any]] = []
        if ready && o.clickAll {
            let buttons = (await run("return (window.__trial && window.__trial.buttons) || []") as? [[String: Any]]) ?? []
            for b in buttons {
                guard let x = b["x"] as? Double, let y = b["y"] as? Double else { continue }
                click(x: x, y: y)
                clicked.append(["id": b["id"] ?? "?", "x": x, "y": y])
                await sleep(1500)
                if !onHome { break }
            }
        }
        await sleep(o.settleMs)

        var astryx: Any = NSNull()
        if o.astryx, ready, let frame = delegate.appFrames.last {
            let body = """
            const end = performance.now() + 10000;
            const root = () => document.querySelector("[data-astryx-root]");
            while (performance.now() < end && !(root() && root().children.length)) await new Promise((r) => setTimeout(r, 100));
            const r = root();
            const box = r ? r.getBoundingClientRect() : null;
            return { address: location.href, rootChildren: r ? r.children.length : -1, elements: r ? r.querySelectorAll("*").length : 0,
              height: box ? Math.round(box.height) : 0, text: (r ? r.innerText : "").slice(0, 200),
              sheets: document.styleSheets.length, errors: window.__trialErrors || [] };
            """
            astryx = await run(body, in: frame) ?? ["error": "the frame could not be read"]
        }
        if let path = o.snapshot, onHome { await snapshot(path) }

        var pasteboardHolds: String?
        if let saved = savedPasteboard {
            let now = NSPasteboard.general.string(forType: .string)
            pasteboardHolds = now == planted ? "planted" : now == framesWrite ? "written by the frame" : "other"
            restorePasteboard(saved)
            pendingPasteboard = nil
        }
        let results: Any = onHome ? (await run("return (window.__trial && window.__trial.results) || {}") ?? [:]) : [:]
        let top: Any = onHome ? (await run("return (window.__trial && window.__trial.top) || {}") ?? [:]) : [:]
        let opener = (inner.opener as? RecordingOpener)?.asked.map(\.absoluteString) ?? []
        let panels = (inner.panels as? RecordingPanels)?.asked ?? []
        var report: [String: Any] = [
            "rules": o.rules, "rulesOn": rulesOn, "factoryHadList": factoryHadList, "ready": ready,
            "topUrl": web.url?.absoluteString ?? "", "onHome": onHome, "dropped": inner.dropped,
            "openerAsked": opener, "panelsAsked": panels, "clicked": clicked, "results": results, "top": top,
            "astryx": astryx, "notes": notes,
        ]
        if let s = o.snapshot { report["snapshot"] = s }
        if let p = pasteboardHolds { report["pasteboardHolds"] = p }
        let data = (try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
        do { try data.write(to: URL(fileURLWithPath: o.json)) } catch { return 1 }
        window.orderOut(nil)
        return ready ? 0 : 1
    }
}

let options = parse(Array(CommandLine.arguments.dropFirst()))
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(options.timeoutMs)) {
    if let saved = pendingPasteboard { restorePasteboard(saved) }
    FileHandle.standardError.write(Data("frames-trial: timed out\n".utf8))
    exit(3)
}
Task { @MainActor in exit(await Trial(options).main()) }
app.run()
