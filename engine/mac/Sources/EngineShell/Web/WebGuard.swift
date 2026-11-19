import WebKit
import os

// The web view's delegate: maps WebKit's callbacks onto NavRequest and carries out NavigationPolicy's
// verdicts (PLAN-MAC 4.3, 4.3b, S3, S4). It holds no bridge: no page can call into it.

/// What happens to one navigation action.
public enum ActionOutcome: Equatable { case allow, download, cancel, open(URL) }

/// The pure half of the delegate, so the checks can run it without a window.
public enum NavMapping {
    /// A navigation in an existing frame. `click` only for an activated link: a form post, a reload,
    /// back and forward, a redirect and a page moving itself are not clicks.
    /// `sourceScheme`, `sourceHost` and `sourcePort` are the asking frame's origin, as WebKit reports it;
    /// `targetFrameURL` the address the target frame shows now; `home` the home screen's origin.
    /// Only an asker exactly on `home` may open any app in a frame. Any other asker (an app, a sandboxed frame
    /// with an opaque origin, an unknown or missing one) is held to one app: its own port when it is an app's
    /// origin, else the port of the app the frame shows, else none (M16b, L5).
    public static func request(url: URL, navigationType: WKNavigationType, targetIsMainFrame: Bool,
                               sourceScheme: String? = nil, sourceHost: String? = nil, sourcePort: Int? = nil,
                               targetFrameURL: URL? = nil, home: HomeOrigin? = nil) -> NavRequest {
        var fromApp: Int?
        let fromHome: Bool
        if let home, let sourceScheme, let sourceHost, let sourcePort {
            fromHome = sourceScheme == home.scheme && sourceHost == home.host && sourcePort == home.port
        } else {
            fromHome = false
        }
        if !fromHome {
            if let sourceScheme, let sourceHost, let sourcePort,
               NavigationPolicy.isAppOrigin(scheme: sourceScheme, host: sourceHost, port: sourcePort) {
                fromApp = sourcePort
            } else if let targetFrameURL, NavigationPolicy.isAppFrame(targetFrameURL) {
                fromApp = URLComponents(string: targetFrameURL.absoluteString)?.port ?? NavRequest.unknownApp
            } else {
                fromApp = NavRequest.unknownApp
            }
        }
        return NavRequest(url: url, mainFrame: targetIsMainFrame, click: navigationType == .linkActivated,
                          newWindow: false, fromAppPort: fromApp)
    }

    /// `createWebViewWith`: WebKit asks only under a click, because pages may not open windows by
    /// themselves (`javaScriptCanOpenWindowsAutomatically` is false).
    public static func newWindowRequest(url: URL) -> NavRequest {
        NavRequest(url: url, mainFrame: true, click: true, newWindow: true)
    }

    public static func outcome(_ verdict: NavVerdict, wantsDownload: Bool) -> ActionOutcome {
        switch verdict {
        case .allow: return wantsDownload ? .download : .allow
        case .download: return .download
        case .external(let url): return .open(url)
        case .drop: return .cancel
        }
    }

    /// The only words a log line may hold about a dropped address: a known scheme name, else "other".
    public static func schemeWord(_ url: URL?) -> String {
        let known = ["http", "https", "about", "blob", "data", "file", "javascript", "mailto", "tel"]
        guard let scheme = url?.scheme, known.contains(scheme) else { return "other" }
        return scheme
    }
}

@MainActor
public final class WebGuard: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    public let policy: NavigationPolicy
    public let role: WebViewRole
    public var opener: ExternalOpener
    public var panels: WebPanels
    /// Called when the home page cannot be shown: a failed load of the top page, or the web process
    /// dying twice. The app shows its off page (D11).
    public var onPageLost: (@MainActor () -> Void)?
    /// Addresses dropped so far. Counted, never kept.
    public private(set) var dropped = 0

    private var lastReloadAfterCrash: Date?
    private let log = Logger(subsystem: "local.uuu.company-engine", category: "web")

    init(policy: NavigationPolicy, role: WebViewRole, opener: ExternalOpener, panels: WebPanels) {
        self.policy = policy; self.role = role; self.opener = opener; self.panels = panels
    }

    private func drop(_ url: URL?, _ what: StaticString) {
        dropped += 1
        let scheme = NavMapping.schemeWord(url)
        log.info("dropped \(what, privacy: .public) scheme=\(scheme, privacy: .public)")
    }

    // MARK: navigation

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { drop(nil, "navigation"); decisionHandler(.cancel); return }
        guard let target = navigationAction.targetFrame else {
            // A new window. WebKit asks createWebViewWith next, which judges it once and makes nothing.
            decisionHandler(.allow)
            return
        }
        let source = sourceFrame(of: navigationAction)?.securityOrigin
        let request = NavMapping.request(url: url, navigationType: navigationAction.navigationType,
                                         targetIsMainFrame: target.isMainFrame, sourceScheme: source?.protocol,
                                         sourceHost: source?.host, sourcePort: source?.port,
                                         targetFrameURL: target.request.url, home: policy.home)
        var verdict = policy.decide(request)
        if verdict == .drop, navigationAction.shouldPerformDownload, let source = sourceFrame(of: navigationAction),
           policy.mayDownloadLocal(url, fromScheme: source.securityOrigin.protocol,
                                   host: source.securityOrigin.host, port: source.securityOrigin.port) {
            verdict = .download
        }
        switch NavMapping.outcome(verdict, wantsDownload: navigationAction.shouldPerformDownload) {
        case .allow: decisionHandler(.allow)
        case .download: decisionHandler(.download)
        case .cancel: drop(url, "navigation"); decisionHandler(.cancel)
        case .open(let outside): decisionHandler(.cancel); opener.open(outside)
        }
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                        decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        let response = navigationResponse.response
        let disposition = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
        switch policy.respond(url: response.url, mainFrame: navigationResponse.isForMainFrame,
                              canShowMIMEType: navigationResponse.canShowMIMEType, contentDisposition: disposition) {
        case .allow: decisionHandler(.allow)
        case .download: decisionHandler(.download)
        case .cancel: drop(response.url, "response"); decisionHandler(.cancel)
        }
    }

    public func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    public func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    public func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                        completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if Self.isOurOwnCancel(error) { return }
        onPageLost?()
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // One reload, then the off page. A crash long after the last reload counts as a first one again.
        if let last = lastReloadAfterCrash, Date().timeIntervalSince(last) < 60 {
            lastReloadAfterCrash = nil
            onPageLost?()
            return
        }
        lastReloadAfterCrash = Date()
        webView.reload()
    }

    /// A load we stopped ourselves (a dropped address, a download) is not a lost page.
    nonisolated static func isOurOwnCancel(_ error: Error) -> Bool {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return true }
        // WebKitErrorFrameLoadInterruptedByPolicyChange (102), and 101 (cannot show this address).
        if e.domain == "WebKitErrorDomain" && (e.code == 102 || e.code == 101) { return true }
        return false
    }

    /// WebKit marks sourceFrame as never nil, but it can be nil for some navigations; read it safely.
    private func sourceFrame(of action: WKNavigationAction) -> WKFrameInfo? {
        action.value(forKey: "sourceFrame") as? WKFrameInfo
    }

    // MARK: windows, panels, messages

    public func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { drop(nil, "window"); return nil }
        if case .external(let outside) = policy.decide(NavMapping.newWindowRequest(url: url)) {
            opener.open(outside)
        } else {
            drop(url, "window")
        }
        return nil
    }

    /// Only the home page itself may show a message; a frame's is refused.
    private func isHomeTop(_ frame: WKFrameInfo) -> Bool {
        let o = frame.securityOrigin
        return frame.isMainFrame && policy.isHomeOrigin(scheme: o.protocol, host: o.host, port: o.port)
    }

    public func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        guard isHomeTop(frame) else { completionHandler(); return }
        panels.showPageMessage(PageMessage.clean(message), confirm: false) { _ in completionHandler() }
    }

    public func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        guard isHomeTop(frame) else { completionHandler(false); return }
        panels.showPageMessage(PageMessage.clean(message), confirm: true) { ok in completionHandler(ok) }
    }

    /// `prompt` is not in the plan's list: always refused (no answer), from any frame.
    public func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                        defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                        completionHandler: @escaping @MainActor (String?) -> Void) {
        completionHandler(nil)
    }

    public func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        panels.chooseFiles(multiple: parameters.allowsMultipleSelection, directories: parameters.allowsDirectories) { urls in
            completionHandler(urls)
        }
    }

    public func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                        initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                        decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        decisionHandler(.deny)
    }

    // MARK: downloads

    public func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                         suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void) {
        panels.chooseSaveLocation(suggestedName: suggestedFilename) { url in completionHandler(url) }
    }

    public func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                         newRequest request: URLRequest, decisionHandler: @escaping @MainActor (WKDownload.RedirectPolicy) -> Void) {
        if let url = request.url, policy.isHome(url) || NavigationPolicy.isAppFrame(url) {
            decisionHandler(.allow)
        } else {
            drop(request.url, "download")
            decisionHandler(.cancel)
        }
    }

    public func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge,
                         completionHandler: @escaping @MainActor (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}
