import AppKit
import WebKit
import EngineShell

// The one window (D3): the home screen's web view, or the off page when nothing serves it (D11). Closing
// the window lets go of the web view; the app stays in the Dock and the menu bar.
@MainActor
final class MainWindowController: NSObject, NSWindowDelegate {
    let window: NSWindow
    private(set) var web: WKWebView?
    private let home: HomeOrigin
    private let policy: NavigationPolicy
    private unowned let app: AppController
    private let offPage = OffPageView()
    private let panels: AppPanels
    var onClose: (() -> Void)?

    private(set) var showingWeb = false
    private var observations: [NSKeyValueObservation] = []

    // D11: /healthz every 2 s on the off page; on the home screen every 1.5 s, two misses in a row show
    // the off page (so a stopped home screen is seen within about 4 s).
    private let probe: HealthProbe
    private var probeTimer: Timer?
    private var probeOut = false
    private var misses = 0
    private var shownWebAt: Date?
    // W16: the page was lost again soon after coming back while /healthz answers; wait before the next try.
    private var notAnswering = false
    private var retryAfter: Date?
    private var pendingPath: String?

    private static let autosaveName = "CompanyEngineMainWindow"

    init(home: HomeOrigin, app: AppController) {
        self.home = home
        self.policy = NavigationPolicy(home: home)
        self.app = app
        self.probe = HealthProbe(home: home)
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.isReleasedWhenClosed = false
        win.title = NativeWords.appName
        win.contentMinSize = NSSize(width: 900, height: 600)
        win.titlebarAppearsTransparent = true
        win.tabbingMode = .disallowed
        win.collectionBehavior.insert(.fullScreenPrimary)
        if !win.setFrameUsingName(Self.autosaveName) { win.center() }
        win.setFrameAutosaveName(Self.autosaveName)
        window = win
        panels = AppPanels(window: win)
        super.init()
        win.delegate = self
        offPage.onStart = { [weak app] in app?.startEngine(nil) }
    }

    func start() {
        makeWeb()
        showWeb(path: GoRoute.home)
    }

    // MARK: the web view

    private func makeWeb() {
        let web = WebViewFactory.make(home: home, role: .app)
        if let guardian = WebViewFactory.webGuard(of: web) {
            guardian.panels = panels
            guardian.onPageLost = { [weak self] in self?.pageLost() }
        }
        // The page follows the system's light or dark (D15); the window's own look follows the page (D14).
        web.appearance = Self.systemAppearance()
        observations = [
            web.observe(\.title, options: [.initial, .new]) { [weak self] web, _ in
                MainActor.assumeIsolated { self?.titleChanged(web.title) }
            },
            web.observe(\.underPageBackgroundColor, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.applyTint() }
            },
            NSApp.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.web?.appearance = Self.systemAppearance() }
            },
        ]
        self.web = web
    }

    private static func systemAppearance() -> NSAppearance? {
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        return NSAppearance(named: dark ? .darkAqua : .aqua)
    }

    private func titleChanged(_ title: String?) {
        guard showingWeb else { return }
        window.title = TitleText.clean(title ?? "")
    }

    /// D14: the title bar takes the page's colour, and a light or dark look from how dark it is.
    private func applyTint() {
        guard showingWeb, let web, let c = web.underPageBackgroundColor.usingColorSpace(.sRGB) else { return }
        window.backgroundColor = c
        let dark = TitleTint.isDark(red: Double(c.redComponent), green: Double(c.greenComponent), blue: Double(c.blueComponent))
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    }

    func go(_ path: String) {
        guard showingWeb, let web, let url = home.url(path) else { pendingPath = path; return }
        web.load(URLRequest(url: url))
    }

    func reload() {
        guard showingWeb, let web else { return }
        if let url = web.url, policy.isHome(url) { web.reload() } else { go(GoRoute.home) }
    }

    func zoom(by step: CGFloat) {
        guard let web else { return }
        web.pageZoom = min(3, max(0.5, (web.pageZoom + step) * 10).rounded() / 10)
    }

    func zoomReset() { web?.pageZoom = 1 }

    // MARK: web view or off page

    private func showWeb(path: String) {
        guard let web else { return }
        showingWeb = true
        misses = 0
        shownWebAt = Date()
        window.contentView = web
        window.makeFirstResponder(web)
        titleChanged(web.title)
        applyTint()
        let target = pendingPath ?? path
        pendingPath = nil
        if target == GoRoute.home, let url = web.url, policy.isHome(url) {
            web.reload()
        } else if let url = home.url(target) {
            web.load(URLRequest(url: url))
        }
        scheduleProbe()
    }

    private func showOff() {
        let wasWeb = showingWeb
        showingWeb = false
        misses = 0
        window.contentView = offPage
        window.appearance = nil
        window.backgroundColor = .windowBackgroundColor
        window.title = NativeWords.appName
        refreshOffPage()
        if wasWeb || probeTimer == nil { scheduleProbe() }
    }

    func refreshOffPage() {
        offPage.update(app.offPageText(notAnswering: notAnswering), lines: app.lastLines)
    }

    /// WebGuard: the top page failed to load, or the web process died twice.
    private func pageLost() {
        if let at = shownWebAt, Date().timeIntervalSince(at) < 10 {
            notAnswering = true
            retryAfter = Date().addingTimeInterval(30)
        }
        if showingWeb { showOff() } else { refreshOffPage() }
    }

    private func scheduleProbe() {
        probeTimer?.invalidate()
        let every: TimeInterval = showingWeb ? 1.5 : 2
        let t = Timer(timeInterval: every, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        t.tolerance = 0.2
        RunLoop.main.add(t, forMode: .common)
        probeTimer = t
    }

    private func tick() {
        guard !probeOut else { return }
        probeOut = true
        probe.check { [weak self] ok in
            MainActor.assumeIsolated { self?.probed(ok) }
        }
    }

    private func probed(_ ok: Bool) {
        probeOut = false
        guard web != nil else { return }
        if showingWeb {
            if ok {
                misses = 0
                if let at = shownWebAt, Date().timeIntervalSince(at) > 10, notAnswering {
                    notAnswering = false
                    retryAfter = nil
                }
            } else {
                misses += 1
                if misses >= 2 { showOff() }
            }
            return
        }
        guard ok else { return }
        if let after = retryAfter, Date() < after { return }
        showWeb(path: GoRoute.home)
    }

    // MARK: NSWindowDelegate

    func windowWillClose(_ notification: Notification) {
        probeTimer?.invalidate()
        probeTimer = nil
        observations.forEach { $0.invalidate() }
        observations = []
        if let web {
            web.stopLoading()
            WebViewFactory.webGuard(of: web)?.onPageLost = nil
        }
        window.contentView = nil
        web = nil
        showingWeb = false
        onClose?()
    }
}
