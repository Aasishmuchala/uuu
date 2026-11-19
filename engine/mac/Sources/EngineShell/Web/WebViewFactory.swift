import WebKit

public enum WebViewRole { case app, probe }

/// The one web view, made the same way for the app and the probe (PLAN-MAC 4.3b). It keeps its guard
/// alive (WebKit holds delegates weakly).
public final class EngineWebView: WKWebView {
    public let webGuard: WebGuard
    /// The rule list on this web view (PLAN-MAC D16): nil only when WebKit could not compile it.
    public let ruleList: WKContentRuleList?

    init(configuration: WKWebViewConfiguration, webGuard: WebGuard, ruleList: WKContentRuleList?) {
        self.webGuard = webGuard
        self.ruleList = ruleList
        super.init(frame: .zero, configuration: configuration)
    }

    required init?(coder: NSCoder) { nil }
}

public enum WebViewFactory {
    @MainActor
    public static func make(homePort: Int, role: WebViewRole) -> WKWebView {
        make(home: .local(port: homePort), role: role)
    }

    @MainActor
    public static func make(home: HomeOrigin, role: WebViewRole) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.applicationNameForUserAgent = "CompanyEngine/\(BuildConstants.version)"
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.preferences.isFraudulentWebsiteWarningEnabled = false
        config.preferences.isElementFullscreenEnabled = true
        // Tab reaches links and buttons too, in the home pages and the apps' frames, whatever this Mac's
        // Keyboard navigation setting (off, WebKit moves Tab between text fields and lists only).
        config.preferences.tabFocusesLinks = true
        // The second fence, in both roles: every load not on the home's origin or an App Studio port is blocked.
        let rules = RuleList.compiled(for: home)
        if let rules { config.userContentController.add(rules) }

        let webGuard = WebGuard(
            policy: NavigationPolicy(home: home), role: role,
            opener: role == .app ? WorkspaceOpener() : RecordingOpener(),
            panels: RecordingPanels())
        let web = EngineWebView(configuration: config, webGuard: webGuard, ruleList: rules)
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

    /// The rule list a web view this factory made carries, or nil.
    @MainActor
    public static func ruleList(of web: WKWebView) -> WKContentRuleList? {
        (web as? EngineWebView)?.ruleList
    }
}
