// webkit-probe (PLAN-MAC D12, PLAN-MAC-2 M4): loads one page of a seeded home in the app's own web view
// (WebViewFactory.make(home:role: .probe): the same configuration, navigation rules and guard), in a window
// placed off every screen, and reports what WebKit did as JSON; may run a script, snapshot to PNG.
// A test tool only: it is never copied into the app bundle, and it alone may run script in a page (S3).
//
// usage: webkit-probe --origin-port <p> --path '/?theme=dark#/tasks' [--size 1280x800] [--scale 2]
//          [--wait-ms n] [--script file.js] [--snapshot out.png] [--full] [--reduced-motion]
//          [--appearance light|dark] [--json out.json] [--timeout-ms n]
// Exit: 0 done; 1 the page did not load, the script threw or the snapshot failed; 2 bad arguments; 3 timed out.
import AppKit
import WebKit
import EngineShell

// MARK: arguments

struct Options {
    var port = 0
    var path = "/"
    var width = 1280
    var height = 800
    var scale = 2.0
    var waitMs = 0
    var script: String?
    var snapshot: String?
    var full = false
    var reducedMotion = false
    var appearance: String?
    var json: String?
    var timeoutMs = 90_000
}

let usage = "usage: webkit-probe --origin-port <3300-65535> --path '/...' [--size WxH] [--scale 1-3] [--wait-ms n] "
    + "[--script file.js] [--snapshot out.png] [--full] [--reduced-motion] [--appearance light|dark] [--json out.json] "
    + "[--timeout-ms n]"

func fail(_ words: String) -> Never {
    FileHandle.standardError.write(Data("webkit-probe: \(words)\n\(usage)\n".utf8))
    exit(2)
}

/// The port rule of build.sh --dev: 3300 to 65535, and not 5000, 5432, 7000 or 8120.
func portAllowed(_ p: Int) -> Bool {
    (3300...65535).contains(p) && ![5000, 5432, 7000, 8120].contains(p)
}

func parse(_ argv: [String]) -> Options {
    var o = Options()
    var i = 0
    var gotPort = false
    func value(_ name: String) -> String {
        i += 1
        guard i < argv.count else { fail("\(name) needs a value.") }
        return argv[i]
    }
    func number(_ name: String, _ text: String, _ range: ClosedRange<Int>) -> Int {
        guard text.count <= 7, text.allSatisfy(\.isASCII), let n = Int(text), range.contains(n) else {
            fail("\(name) must be a number from \(range.lowerBound) to \(range.upperBound).")
        }
        return n
    }
    while i < argv.count {
        let a = argv[i]
        switch a {
        case "--origin-port":
            o.port = number(a, value(a), 0...65535)
            guard portAllowed(o.port) else { fail("the port must be 3300 to 65535, and not 5000, 5432, 7000 or 8120.") }
            gotPort = true
        case "--path": o.path = value(a)
        case "--size":
            let parts = value(a).split(separator: "x", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 2 else { fail("--size is WIDTHxHEIGHT, for example 1280x800.") }
            o.width = number("the width", parts[0], 200...4000)
            o.height = number("the height", parts[1], 200...6000)
        case "--scale":
            guard let s = Double(value(a)), s >= 1, s <= 3 else { fail("--scale must be from 1 to 3.") }
            o.scale = s
        case "--wait-ms": o.waitMs = number(a, value(a), 0...60_000)
        case "--script": o.script = value(a)
        case "--snapshot": o.snapshot = value(a)
        case "--full": o.full = true
        case "--reduced-motion": o.reducedMotion = true
        case "--appearance":
            let v = value(a)
            guard v == "light" || v == "dark" else { fail("--appearance is light or dark.") }
            o.appearance = v
        case "--json": o.json = value(a)
        case "--timeout-ms": o.timeoutMs = number(a, value(a), 1_000...600_000)
        case "-h", "--help":
            print(usage); exit(0)
        default: fail("unknown argument \(a)")
        }
        i += 1
    }
    guard gotPort else { fail("--origin-port is needed.") }
    return o
}

// MARK: what the page tells the probe

/// The probe's own user script (main frame only, at document start): it records console.error, uncaught errors and
/// rejections, failed resource loads and fetches, content-policy violations and every WebGL context asked for, and
/// keeps a count of fetches in flight and the time of the last network activity, so the probe can wait for quiet.
let recorderSource = #"""
(() => {
  const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.probe;
  const post = (k, t) => { try { h.postMessage({ k, t: String(t).slice(0, 500) }); } catch (e) {} };
  const word = (x) => { try { return x instanceof Error ? (x.stack || x.message) : (typeof x === "object" ? JSON.stringify(x) : String(x)); } catch (e) { return String(x); } };
  const p = (window.__probe = { inflight: 0, last: performance.now(), webgl: 0 });
  const touch = () => { p.last = performance.now(); };
  const oe = console.error;
  console.error = function (...a) { post("console", a.map(word).join(" ")); return oe.apply(this, a); };
  addEventListener("error", (e) => {
    if (e instanceof ErrorEvent) { post("error", `${e.message} (${e.filename || "?"}:${e.lineno || 0})`); return; }
    const el = e.target;
    if (el && el !== window) post("failed", `${(el.tagName || "?").toLowerCase()} ${el.currentSrc || el.src || el.href || ""}`);
  }, true);
  addEventListener("unhandledrejection", (e) => post("error", `unhandled rejection: ${word(e.reason)}`));
  document.addEventListener("securitypolicyviolation", (e) => post("csp", `${e.effectiveDirective || e.violatedDirective} ${e.blockedURI}`), true);
  const wrap = (proto) => {
    if (!proto || !proto.getContext) return;
    const get = proto.getContext;
    proto.getContext = function (type, ...rest) {
      if (/^(webgl2?|experimental-webgl)$/i.test(String(type))) { p.webgl++; post("webgl", type); }
      return get.call(this, type, ...rest);
    };
  };
  wrap(window.HTMLCanvasElement && HTMLCanvasElement.prototype);
  wrap(window.OffscreenCanvas && OffscreenCanvas.prototype);
  const f = window.fetch;
  if (f) window.fetch = function (...a) {
    p.inflight++; touch();
    const what = (a[0] && a[0].url) || a[0];
    return f.apply(this, a).then((r) => { p.inflight--; touch(); if (r.status >= 400) post("failed", `${r.status} ${r.url || what}`); return r; },
      (err) => { p.inflight--; touch(); post("failed", `fetch ${what}: ${word(err)}`); throw err; });
  };
  try { new PerformanceObserver(touch).observe({ type: "resource", buffered: false }); } catch (e) {}
})();
"""#

/// With --reduced-motion: the page's matchMedia answers "reduce" (WebKit gives no switch for it; style sheets still
/// see the system's own answer, so the harness also passes the web app's `motion=off`).
let reducedMotionSource = #"""
(() => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    const s = String(q);
    if (/prefers-reduced-motion/.test(s)) {
      const yes = /reduce/.test(s) && !/no-preference/.test(s);
      return { matches: yes, media: s, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
    }
    return mm(q);
  };
})();
"""#

final class Sink: NSObject, WKScriptMessageHandler {
    var console: [String] = []
    var csp: [String] = []
    var failed: [String] = []
    var webglTypes: [String] = []
    private let cap = 200

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any],
              let kind = body["k"] as? String, let text = body["t"] as? String else { return }
        switch kind {
        case "console", "error": if console.count < cap { console.append(text) }
        case "csp": if csp.count < cap { csp.append(text) }
        case "failed": if failed.count < cap { failed.append(text) }
        case "webgl": if webglTypes.count < cap { webglTypes.append(text) }
        default: break
        }
    }
}

// MARK: the run

@MainActor
final class Probe {
    let o: Options
    let home: HomeOrigin
    let sink = Sink()
    var web: WKWebView!
    var window: NSWindow!
    var pageLost = false
    var notes: [String] = []
    var scriptResult: Any = NSNull()
    var scriptError: String?

    init(_ o: Options) {
        self.o = o
        self.home = .local(port: o.port)
    }

    func sleep(_ ms: Int) async { try? await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }

    /// Runs `body` as an async function in the page and gives back what it returned (JSON-decoded), or throws.
    func run(_ body: String) async throws -> Any {
        let wrapped = "const __v = await (async () => {\n\(body)\n})(); return JSON.stringify(__v === undefined ? null : __v);"
        let out = try await web.callAsyncJavaScript(wrapped, arguments: [:], in: nil, contentWorld: .page)
        guard let text = out as? String, let data = text.data(using: .utf8) else { return NSNull() }
        return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) ?? NSNull()
    }

    func tryRun(_ body: String) async -> Any? { try? await run(body) }

    /// Waits until the top page has loaded (or was lost), at most `ms`.
    func waitLoaded(_ ms: Int) async -> Bool {
        let end = Date().addingTimeInterval(Double(ms) / 1000)
        while Date() < end {
            if pageLost { return false }
            if !web.isLoading, let state = await tryRun("return document.readyState") as? String, state == "complete" {
                return true
            }
            await sleep(50)
        }
        return false
    }

    /// No fetch in flight and no resource loaded for 400 ms (at most `ms`), then a frame (or 200 ms if none comes).
    func waitQuiet(_ ms: Int) async -> Bool {
        let body = """
        const p = window.__probe || { inflight: 0, last: 0 };
        const end = performance.now() + \(ms);
        let quiet = false;
        while (performance.now() < end) {
          if (p.inflight === 0 && performance.now() - p.last >= 400) { quiet = true; break; }
          await new Promise((r) => setTimeout(r, 50));
        }
        await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 200))]);
        return quiet;
        """
        return (await tryRun(body) as? Bool) ?? false
    }

    /// requestAnimationFrame's callbacks over `ms` (at least 300): how many and the median gap.
    func frames(_ ms: Int) async -> [String: Any] {
        let body = """
        const t = [];
        const end = performance.now() + \(max(300, ms));
        await new Promise((done) => {
          const tick = (now) => { t.push(now); if (now < end) requestAnimationFrame(tick); else done(); };
          requestAnimationFrame(tick);
          setTimeout(done, \(max(300, ms)) + 250);
        });
        const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
        const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
        return { count: t.length, medianMs: median === null ? null : Math.round(median * 10) / 10, overMs: \(max(300, ms)) };
        """
        return (await tryRun(body) as? [String: Any]) ?? ["count": 0, "medianMs": NSNull()]
    }

    func images() async -> [String: Any] {
        let body = """
        const all = [...document.images];
        const broken = all.filter((i) => i.complete && (i.currentSrc || i.getAttribute("src")) && i.naturalWidth === 0);
        return { total: all.length, broken: broken.length, brokenSrc: broken.slice(0, 10).map((i) => (i.currentSrc || i.getAttribute("src")).slice(0, 300)) };
        """
        return (await tryRun(body) as? [String: Any]) ?? ["total": 0, "broken": 0]
    }

    func pageHeight() async -> Int {
        let body = """
        const d = document.documentElement;
        let extra = 0;
        for (const e of document.querySelectorAll("body *")) {
          const cs = getComputedStyle(e);
          if (/(auto|scroll)/.test(cs.overflowY) && e.clientHeight > 200 && e.scrollHeight > e.clientHeight + 1) extra = Math.max(extra, e.scrollHeight - e.clientHeight);
        }
        return Math.ceil(Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0) + extra);
        """
        return (await tryRun(body) as? Int) ?? o.height
    }

    /// The snapshot at `o.scale`, `w` x `h` points: WebKit's picture drawn into a bitmap of exactly that many pixels.
    func snapshot(to path: String, height h: Int, rect: CGRect?) async -> Bool {
        let cfg = WKSnapshotConfiguration()
        if let rect { cfg.rect = rect }
        cfg.snapshotWidth = NSNumber(value: o.width)
        cfg.afterScreenUpdates = true
        guard let image = try? await web.takeSnapshot(configuration: cfg) else { notes.append("takeSnapshot gave no picture"); return false }
        let pw = Int((Double(o.width) * o.scale).rounded()), ph = Int((Double(h) * o.scale).rounded())
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pw, pixelsHigh: ph, bitsPerSample: 8,
                                         samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0),
              let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return false }
        // The bitmap's context counts in pixels until the rep is given its size in points, which is done after.
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        ctx.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pw, height: ph), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        rep.size = NSSize(width: o.width, height: h)
        guard let png = rep.representation(using: .png, properties: [:]) else { return false }
        do {
            try png.write(to: URL(fileURLWithPath: path), options: .atomic)
        } catch {
            notes.append("could not write \(path)")
            return false
        }
        return true
    }

    func main() async -> Int32 {
        guard let url = home.url(o.path) else { fail("--path must start with one \"/\" and hold no space or control character.") }
        var scriptText: String?
        if let s = o.script {
            guard let t = try? String(contentsOfFile: s, encoding: .utf8) else { fail("cannot read the script \(s).") }
            scriptText = t
        }

        // The probe's own website data (not the app's: another program, another folder) is cleared before every run,
        // so no look or setting carries over from one picture to the next.
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)

        web = WebViewFactory.make(home: home, role: .probe)
        let ucc = web.configuration.userContentController
        ucc.add(sink, contentWorld: .page, name: "probe")
        ucc.addUserScript(WKUserScript(source: recorderSource, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if o.reducedMotion {
            ucc.addUserScript(WKUserScript(source: reducedMotionSource, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        WebViewFactory.webGuard(of: web)?.onPageLost = { [weak self] in self?.pageLost = true }

        // A borderless window far off every screen: never seen, never takes the focus.
        window = NSWindow(contentRect: NSRect(x: -32000, y: -32000, width: o.width, height: o.height),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        if let a = o.appearance {
            let look = NSAppearance(named: a == "dark" ? .darkAqua : .aqua)
            window.appearance = look
            web.appearance = look
        }
        // A window off every screen counts as hidden, and WebKit then holds back drawing and animation frames
        // (requestAnimationFrame gave 0 callbacks in 1 s). WebKit's own switch for tests turns that judgement off,
        // for this probe's web view only; it is not public, so it is asked for by name and skipped when absent.
        let occlusion = Selector(("_setWindowOcclusionDetectionEnabled:"))
        if web.responds(to: occlusion), let imp = web.method(for: occlusion) {
            typealias SetBool = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(imp, to: SetBool.self)(web, occlusion, false)
        } else {
            notes.append("this WebKit has no switch for window occlusion; the page may count as hidden")
        }
        window.contentView = web
        web.frame = NSRect(x: 0, y: 0, width: o.width, height: o.height)
        window.orderFrontRegardless()

        let t0 = Date()
        web.load(URLRequest(url: url))
        let loaded = await waitLoaded(30_000)
        if !loaded { notes.append(pageLost ? "the page was lost (failed load)" : "the page did not finish loading in 30 s") }
        var quiet = false
        var frameInfo: [String: Any] = ["count": 0, "medianMs": NSNull()]
        if loaded {
            _ = await tryRun("if (document.fonts) await document.fonts.ready; return true;")
            quiet = await waitQuiet(8000)
            if !quiet { notes.append("the network was not quiet in 8 s") }
            frameInfo = await frames(o.waitMs)
            if let scriptText {
                do { scriptResult = try await run(scriptText) } catch {
                    scriptError = String(String(describing: error).prefix(500))
                }
                if !(await waitQuiet(8000)) { notes.append("the network was not quiet in 8 s after the script") }
            }
        }

        var snapshotOk: Bool?
        var fullHeight: Int?
        if let path = o.snapshot, loaded {
            if o.full {
                // The whole page, at most 6000 points: the view is made as tall as the page (WebKit's snapshot of a rect
                // past the view's bounds draws nothing there), the picture taken, the view put back.
                let fh = min(6000, max(o.height, await pageHeight()))
                fullHeight = fh
                _ = await tryRun("window.scrollTo(0, 0); return true;")
                window.setContentSize(NSSize(width: o.width, height: fh))
                web.frame = NSRect(x: 0, y: 0, width: o.width, height: fh)
                _ = await waitQuiet(3000)
                snapshotOk = await snapshot(to: path, height: fh, rect: CGRect(x: 0, y: 0, width: o.width, height: fh))
                window.setContentSize(NSSize(width: o.width, height: o.height))
                web.frame = NSRect(x: 0, y: 0, width: o.width, height: o.height)
            } else {
                snapshotOk = await snapshot(to: path, height: o.height, rect: CGRect(x: 0, y: 0, width: o.width, height: o.height))
            }
        }

        let guardian = WebViewFactory.webGuard(of: web)
        let counted = await tryRun("return (window.__probe && window.__probe.webgl) || 0") as? Int
        let webgl: Int = max(counted ?? 0, sink.webglTypes.count)
        let imageInfo: [String: Any] = loaded ? await images() : ["total": 0, "broken": 0]
        let asked: [String] = (guardian?.opener as? RecordingOpener)?.asked.map { $0.absoluteString } ?? []
        let panels: [String] = (guardian?.panels as? RecordingPanels)?.asked ?? []
        let size: [String: Any] = ["width": o.width, "height": o.height, "scale": o.scale]
        let shownURL: String = web.url?.absoluteString ?? url.absoluteString
        var report: [String: Any] = [:]
        report["url"] = shownURL
        report["title"] = web.title ?? ""
        report["loaded"] = loaded
        report["quiet"] = quiet
        report["consoleErrors"] = sink.console
        report["cspViolations"] = sink.csp
        report["failedRequests"] = sink.failed
        report["dropped"] = guardian?.dropped ?? 0
        report["externalAsked"] = asked
        report["panelsAsked"] = panels
        report["scriptResult"] = scriptResult
        report["webglContexts"] = webgl
        report["images"] = imageInfo
        report["frames"] = frameInfo
        report["size"] = size
        report["appearance"] = o.appearance ?? "system"
        report["visibility"] = (await tryRun("return document.visibilityState") as? String) ?? "unknown"
        report["notes"] = notes
        report["elapsedMs"] = Int(Date().timeIntervalSince(t0) * 1000)
        if let scriptError { report["scriptError"] = scriptError }
        if let path = o.snapshot { report["snapshot"] = snapshotOk == true ? path : NSNull() }
        if let fullHeight { report["fullHeight"] = fullHeight }

        let data = (try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
        if let j = o.json {
            do { try data.write(to: URL(fileURLWithPath: j), options: .atomic) } catch {
                FileHandle.standardError.write(Data("webkit-probe: could not write \(j)\n".utf8))
                return 1
            }
        } else {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
        window.orderOut(nil)
        if !loaded || scriptError != nil || snapshotOk == false { return 1 }
        return 0
    }
}

let options = parse(Array(CommandLine.arguments.dropFirst()))
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(options.timeoutMs)) {
    FileHandle.standardError.write(Data("webkit-probe: timed out after \(options.timeoutMs) ms\n".utf8))
    exit(3)
}
Task { @MainActor in
    let code = await Probe(options).main()
    exit(code)
}
app.run()
