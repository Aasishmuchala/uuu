import WebKit

public enum WebViewRole { case app, probe }

/// The one web view, made the same way for the app and the probe (PLAN-MAC 4.3b). It keeps its guard
/// alive (WebKit holds delegates weakly).
public final class EngineWebView: WKWebView {
    public let webGuard: WebGuard

    init(configuration: WKWebViewConfiguration, webGuard: WebGuard) {
        self.webGuard = webGuard
        super.init(frame: .zero, configuration: configuration)
    }

    required init?(coder: NSCoder) { nil }
}

public enum WebViewFactory {
    @MainActor
    public static func make(homePort: Int, role: WebViewRole) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "CompanyEngine/\(BuildConstants.version)"
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isFraudulentWebsiteWarningEnabled = false
        config.preferences.isElementFullscreenEnabled = true

        let webGuard = WebGuard(
            policy: NavigationPolicy(homePort: homePort), role: role,
            opener: role == .app ? WorkspaceOpener() : RecordingOpener(),
            panels: RecordingPanels())
        let web = EngineWebView(configuration: config, webGuard: webGuard)
        web.navigationDelegate = webGuard
        web.uiDelegate = webGuard
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = true
        web.allowsMagnification = true
        web.isInspectable = BuildConstants.flavor == "dev"
        return web
    }

    /// The guard of a web view this factory made: the app sets its panels and `onPageLost` on it, the
    /// probe reads what was dropped, opened and asked.
    @MainActor
    public static func webGuard(of web: WKWebView) -> WebGuard? {
        (web as? EngineWebView)?.webGuard
    }
}
