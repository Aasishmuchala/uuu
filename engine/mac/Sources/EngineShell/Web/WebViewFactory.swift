import WebKit

public enum WebViewRole { case app, probe }

public enum WebViewFactory {
    @MainActor
    public static func make(homePort: Int, role: WebViewRole) -> WKWebView {
        WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    }
}
