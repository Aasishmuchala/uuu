import Foundation
import WebKit
import EngineShell

// Checks for EngineShell/Web: the navigation table of PLAN-MAC 4.3 row by row, hostile addresses,
// the delegate's mapping, the response rule, page messages and the factory's configuration.

struct WebCheckFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ ok: Bool, _ why: @autoclosure () -> String) throws {
    if !ok { throw WebCheckFailure(description: why()) }
}

private enum Want { case allow, external, drop }

private func verdictWord(_ v: NavVerdict) -> String {
    switch v {
    case .allow: return "allow"
    case .external: return "external"
    case .drop: return "drop"
    case .download: return "download"
    }
}

private let policy = NavigationPolicy(homePort: 3200)

/// One navigation check. An address Foundation cannot parse never reaches the delegate (WebKit hands
/// over parsed addresses only); it passes only where the rule is drop anyway.
private func nav(_ name: String, _ address: String, main: Bool, click: Bool, newWindow: Bool, _ want: Want) -> Check {
    let flags = "\(main ? "main" : "frame")\(click ? " click" : "")\(newWindow ? " new" : "")"
    return Check(name: "nav: \(name) [\(flags)] -> \(want)") {
        guard let url = URL(string: address) else {
            try expect(want == .drop, "not an address, but the rule wants \(want)")
            return
        }
        let got = policy.decide(NavRequest(url: url, mainFrame: main, click: click, newWindow: newWindow))
        switch (want, got) {
        case (.allow, .allow), (.drop, .drop): return
        case (.external, .external(let out)): try expect(out == url, "external opened another address")
        default: throw WebCheckFailure(description: "got \(verdictWord(got)) for \(url.absoluteString.prefix(120))")
        }
    }
}

/// The rows marked "any": every value of the flag.
private func navAny(_ name: String, _ address: String, main: [Bool], click: [Bool], newWindow: [Bool], _ want: Want) -> [Check] {
    var out: [Check] = []
    for m in main { for c in click { for n in newWindow { out.append(nav(name, address, main: m, click: c, newWindow: n, want)) } } }
    return out
}

private let any = [true, false]

private func tableChecks() -> [Check] {
    var c: [Check] = []
    c.append(nav("home", "http://127.0.0.1:3200/", main: true, click: false, newWindow: false, .allow))
    c.append(nav("home task with query", "http://127.0.0.1:3200/#/tasks/ABC-1?x=1", main: true, click: true, newWindow: false, .allow))
    c.append(nav("home raw file download", "http://127.0.0.1:3200/api/brain/raw/abc?download=1", main: true, click: true, newWindow: false, .allow))
    c.append(nav("home in a new window", "http://127.0.0.1:3200/#/map", main: true, click: true, newWindow: true, .external))
    c.append(nav("localhost clicked", "http://localhost:3200/", main: true, click: true, newWindow: false, .external))
    c.append(nav("localhost not clicked", "http://localhost:3200/", main: true, click: false, newWindow: false, .drop))
    c.append(nav("user name before evil host", "http://127.0.0.1:3200@evil.example/", main: true, click: true, newWindow: false, .drop))
    c.append(nav("loopback-looking subdomain", "http://127.0.0.1.evil.example:3200/", main: true, click: true, newWindow: false, .external))
    c.append(nav("ipv6 loopback", "http://[::1]:3200/", main: true, click: true, newWindow: false, .external))
    c.append(nav("hex loopback", "http://0x7f.1:3200/", main: true, click: true, newWindow: false, .external))
    c.append(nav("decimal loopback", "http://2130706433:3200/", main: true, click: true, newWindow: false, .external))
    c.append(nav("https to home port", "https://127.0.0.1:3200/", main: true, click: false, newWindow: false, .drop))
    c.append(nav("app in its own window", "http://127.0.0.1:3171/", main: true, click: true, newWindow: true, .external))
    c.append(nav("app as top page", "http://127.0.0.1:3171/", main: true, click: false, newWindow: false, .drop))
    c.append(nav("app frame", "http://127.0.0.1:3171/x", main: false, click: false, newWindow: false, .allow))
    c.append(nav("last app frame", "http://127.0.0.1:3189/", main: false, click: false, newWindow: false, .allow))
    for port in [3170, 3190, 3200, 3100] {
        c.append(nav("frame on port \(port)", "http://127.0.0.1:\(port)/", main: false, click: false, newWindow: false, .drop))
    }
    c.append(nav("app frame by localhost", "http://localhost:3171/", main: false, click: false, newWindow: false, .drop))
    c.append(nav("outside clicked", "https://example.com/a", main: true, click: true, newWindow: false, .external))
    c.append(nav("outside not clicked", "https://example.com/a", main: true, click: false, newWindow: false, .drop))
    c += navAny("outside in a frame", "https://example.com/a", main: [false], click: any, newWindow: [false], .drop)
    c.append(nav("outside over 2,048", "https://example.com/" + String(repeating: "a", count: 2_050), main: true, click: true, newWindow: false, .drop))
    for address in ["file:///etc/hosts", "javascript:alert(1)", "data:text/html,x", "blob:http://127.0.0.1:3200/x"] {
        c += navAny("not a web address \(address)", address, main: [true], click: [true], newWindow: any, .drop)
    }
    for address in ["mailto:a@b.c", "tel:1", "ssh://h", "smb://h/s", "vnc://h", "x-apple.systempreferences:", "companyengine://x"] {
        c += navAny("other scheme \(address)", address, main: any, click: [true], newWindow: any, .drop)
    }
    c.append(nav("blank frame", "about:blank", main: false, click: false, newWindow: false, .allow))
    c += navAny("blank top page", "about:blank", main: [true], click: any, newWindow: any, .drop)
    return c
}

private func hostileChecks() -> [Check] {
    var c: [Check] = []
    func add(_ name: String, _ a: String, _ m: Bool, _ k: Bool, _ n: Bool, _ w: Want) { c.append(nav(name, a, main: m, click: k, newWindow: n, w)) }
    add("upper-case scheme home", "HTTP://127.0.0.1:3200/", true, false, false, .drop)
    add("upper-case scheme clicked", "HTTP://127.0.0.1:3200/", true, true, false, .drop)
    add("mixed-case scheme outside", "HtTpS://example.com/", true, true, false, .drop)
    add("mixed-case scheme app frame", "Http://127.0.0.1:3171/x", false, false, false, .drop)
    add("trailing-dot host as home", "http://127.0.0.1.:3200/", true, false, false, .drop)
    add("trailing-dot host clicked", "http://127.0.0.1.:3200/", true, true, false, .external)
    add("trailing-dot host as frame", "http://127.0.0.1.:3171/", false, false, false, .drop)
    add("percent-encoded host as home", "http://%31%32%37.0.0.1:3200/", true, false, false, .drop)
    add("percent-encoded host clicked", "http://%31%32%37.0.0.1:3200/", true, true, false, .drop)
    add("percent-encoded dot host", "http://127%2E0.0.1:3171/", false, false, false, .drop)
    add("tab inside host", "http://127.0.\t0.1:3200/", true, true, false, .drop)
    add("newline inside host", "http://127.0.0.1\n.evil.example/", true, true, false, .drop)
    // Foundation hands this over as https://example.com/a%09b: a harmless, visible address.
    add("tab inside outside path (made %09)", "https://example.com/a\tb", true, true, false, .external)
    add("tab inside outside path, not clicked", "https://example.com/a\tb", true, false, false, .drop)
    add("port 0 outside", "http://example.com:0/", true, true, false, .drop)
    add("space in host", "http://127.0.0.1 :3200/", true, false, false, .drop)
    add("port 03200 as home", "http://127.0.0.1:03200/", true, false, false, .drop)
    add("port 03171 as frame", "http://127.0.0.1:03171/", false, false, false, .drop)
    add("ipv6-mapped loopback as home", "http://[::ffff:127.0.0.1]:3200/", true, false, false, .drop)
    add("ipv6-mapped loopback clicked", "http://[::ffff:127.0.0.1]:3200/", true, true, false, .external)
    add("ipv6-mapped hex as frame", "http://[::ffff:7f00:1]:3171/", false, false, false, .drop)
    add("short loopback 127.1", "http://127.1:3200/", true, false, false, .drop)
    add("other loopback 127.0.0.2", "http://127.0.0.2:3200/", true, false, false, .drop)
    add("any address 0.0.0.0", "http://0.0.0.0:3200/", true, false, false, .drop)
    add("localhost with dot", "http://localhost.:3200/", true, false, false, .drop)
    add("empty host with port", "http://:3200/", true, true, false, .drop)
    add("empty host", "http:///x", true, true, false, .drop)
    add("one slash", "http:/127.0.0.1:3200/", true, true, false, .drop)
    add("no slashes", "http:127.0.0.1:3200", true, true, false, .drop)
    add("backslash before evil", "http://127.0.0.1:3200\\@evil.example/", true, true, false, .drop)
    add("user and password home", "http://user:pass@127.0.0.1:3200/", true, false, false, .drop)
    add("empty user home", "http://@127.0.0.1:3200/", true, false, false, .drop)
    add("empty user and password frame", "http://:@127.0.0.1:3171/", false, false, false, .drop)
    add("user name on app frame", "http://127.0.0.1:3171@evil.example/", false, false, false, .drop)
    add("port as user outside", "https://example.com:443@evil.example/", true, true, false, .drop)
    add("home with no path", "http://127.0.0.1:3200", true, false, false, .allow)
    add("home fragment with no path", "http://127.0.0.1:3200#/x", true, false, false, .allow)
    add("home dot segments", "http://127.0.0.1:3200/%2e%2e/%2e%2e/etc", true, false, false, .allow)
    add("home 10,000 characters", "http://127.0.0.1:3200/#/" + String(repeating: "x", count: 10_000), true, false, false, .allow)
    add("outside 10,000 characters", "https://example.com/" + String(repeating: "x", count: 10_000), true, true, false, .drop)
    add("outside 10,000 characters in a new window", "https://example.com/" + String(repeating: "x", count: 10_000), true, true, true, .drop)
    add("outside exactly 2,048", "https://example.com/" + String(repeating: "a", count: 2_048 - 20), true, true, false, .external)
    add("outside 2,049", "https://example.com/" + String(repeating: "a", count: 2_049 - 20), true, true, false, .drop)
    add("double port", "http://127.0.0.1:3200:3200/", true, false, false, .drop)
    add("port out of range", "http://127.0.0.1:99999/", true, true, false, .drop)
    add("negative port", "http://127.0.0.1:-1/", true, true, false, .drop)
    add("port glued to evil host", "http://127.0.0.1:3200.evil.example/", true, true, false, .drop)
    add("home address in evil fragment", "http://evil.example/#http://127.0.0.1:3200/", true, false, false, .drop)
    add("home address in evil query", "http://evil.example/?u=http://127.0.0.1:3200/", true, false, false, .drop)
    add("home without a click in a new window", "http://127.0.0.1:3200/", true, false, true, .drop)
    add("app without a click in a new window", "http://127.0.0.1:3171/", true, false, true, .drop)
    add("app new window from a frame", "http://127.0.0.1:3171/", false, true, true, .external)
    add("app clicked as top page", "http://127.0.0.1:3189/", true, true, false, .external)
    add("home clicked inside a frame", "http://127.0.0.1:3200/", false, true, false, .drop)
    add("https app frame", "https://127.0.0.1:3171/", false, false, false, .drop)
    add("websocket scheme", "ws://127.0.0.1:3200/", true, true, false, .drop)
    add("ftp", "ftp://example.com/", true, true, false, .drop)
    add("view-source of home", "view-source:http://127.0.0.1:3200/", true, true, false, .drop)
    add("file on loopback host", "file://127.0.0.1/etc/hosts", true, true, false, .drop)
    add("applescript", "applescript://com.apple.scripteditor?action=new&script=x", true, true, false, .drop)
    add("facetime", "facetime://a", true, true, true, .drop)
    add("app store", "itms-apps://x", true, true, false, .drop)
    add("help book", "help:anchor=x", true, true, false, .drop)
    add("system settings pane", "x-apple.systempreferences:com.apple.preference.security", true, true, false, .drop)
    add("blank with fragment as frame", "about:blank#x", false, false, false, .drop)
    add("srcdoc frame", "about:srcdoc", false, false, false, .drop)
    add("upper-case blank frame", "ABOUT:BLANK", false, false, false, .drop)
    add("blank in a new window", "about:blank", true, true, true, .drop)
    add("direction override in host", "https://exa\u{202E}mple.com/", true, true, false, .drop)
    add("punycode host clicked", "https://xn--e1afmkfd.xn--p1ai/", true, true, false, .external)
    add("outside with no path clicked", "http://example.com", true, true, false, .external)
    add("blob of evil origin", "blob:https://evil.example/x", true, true, false, .drop)
    add("data in a frame", "data:text/html,<script>top.location='https://e'</script>", false, false, false, .drop)
    return c
}

// The delegate's mapping, as the delegate uses it (no window needed).
private func mappingChecks() -> [Check] {
    var c: [Check] = []
    let home = URL(string: "http://127.0.0.1:3200/#/tasks")!
    let evil = URL(string: "https://evil.example/")!
    let types: [(WKNavigationType, String, Bool)] = [
        (.linkActivated, "link", true), (.formSubmitted, "form post", false), (.formResubmitted, "form again", false),
        (.backForward, "back or forward", false), (.reload, "reload", false), (.other, "redirect or script", false),
    ]
    for (type, word, click) in types {
        c.append(Check(name: "nav: map \(word) is \(click ? "a click" : "not a click")") {
            let r = NavMapping.request(url: home, navigationType: type, targetIsMainFrame: true)
            try expect(r.click == click && r.mainFrame && !r.newWindow, "mapped \(r.click) \(r.mainFrame) \(r.newWindow)")
        })
        c.append(Check(name: "nav: map \(word) inside the home origin is allowed") {
            let r = NavMapping.request(url: home, navigationType: type, targetIsMainFrame: true)
            try expect(policy.decide(r) == .allow, "not allowed")
        })
    }
    c.append(Check(name: "nav: map form post off the origin drops") {
        try expect(policy.decide(NavMapping.request(url: evil, navigationType: .formSubmitted, targetIsMainFrame: true)) == .drop, "not dropped")
    })
    c.append(Check(name: "nav: map redirect hop off the origin without a click drops") {
        try expect(policy.decide(NavMapping.request(url: evil, navigationType: .other, targetIsMainFrame: true)) == .drop, "not dropped")
    })
    c.append(Check(name: "nav: map redirect hop off the origin after a click goes outside") {
        try expect(policy.decide(NavMapping.request(url: evil, navigationType: .linkActivated, targetIsMainFrame: true)) == .external(evil), "not external")
    })
    c.append(Check(name: "nav: map app frame redirected to the home origin drops") {
        let r = NavMapping.request(url: URL(string: "http://127.0.0.1:3200/api/x")!, navigationType: .other, targetIsMainFrame: false)
        try expect(policy.decide(r) == .drop, "not dropped")
    })
    c.append(Check(name: "nav: map app frame redirected to another app stays a frame") {
        let r = NavMapping.request(url: URL(string: "http://127.0.0.1:3172/")!, navigationType: .other, targetIsMainFrame: false)
        try expect(policy.decide(r) == .allow, "not allowed")
    })
    c.append(Check(name: "nav: map app frame link to outside drops") {
        let r = NavMapping.request(url: evil, navigationType: .linkActivated, targetIsMainFrame: false)
        try expect(policy.decide(r) == .drop, "not dropped")
    })
    c.append(Check(name: "nav: map new window is a click in a new top window") {
        let r = NavMapping.newWindowRequest(url: evil)
        try expect(r.click && r.mainFrame && r.newWindow, "wrong flags")
        try expect(policy.decide(r) == .external(evil), "not external")
    })
    c.append(Check(name: "nav: map new window of a data address drops") {
        try expect(policy.decide(NavMapping.newWindowRequest(url: URL(string: "data:text/html,x")!)) == .drop, "not dropped")
    })
    c.append(Check(name: "nav: map new window of the home page goes outside") {
        try expect(policy.decide(NavMapping.newWindowRequest(url: home)) == .external(home), "not external")
    })
    c.append(Check(name: "nav: outcome allow with download attribute is a download") {
        try expect(NavMapping.outcome(.allow, wantsDownload: true) == .download, "no")
    })
    c.append(Check(name: "nav: outcome allow, external, drop") {
        try expect(NavMapping.outcome(.allow, wantsDownload: false) == .allow, "allow")
        try expect(NavMapping.outcome(.external(evil), wantsDownload: false) == .open(evil), "external")
        try expect(NavMapping.outcome(.external(evil), wantsDownload: true) == .open(evil), "external download")
        try expect(NavMapping.outcome(.drop, wantsDownload: true) == .cancel, "drop download")
        try expect(NavMapping.outcome(.drop, wantsDownload: false) == .cancel, "drop")
    })
    return c
}

private func responseChecks() -> [Check] {
    let home = URL(string: "http://127.0.0.1:3200/")!
    let raw = URL(string: "http://127.0.0.1:3200/api/brain/raw/abc?download=1")!
    let app = URL(string: "http://127.0.0.1:3171/")!
    let evil = URL(string: "https://evil.example/")!
    func r(_ name: String, _ url: URL?, _ main: Bool, _ show: Bool, _ disp: String?, _ want: ResponseOutcome) -> Check {
        Check(name: "nav: response \(name) -> \(want)") {
            let got = policy.respond(url: url, mainFrame: main, canShowMIMEType: show, contentDisposition: disp)
            try expect(got == want, "got \(got)")
        }
    }
    return [
        r("home page", home, true, true, nil, .allow),
        r("home attachment", raw, true, true, "attachment; filename=\"a.pdf\"", .download),
        r("home attachment in capitals", raw, true, true, "  Attachment;filename=a", .download),
        r("home inline", raw, true, true, "inline", .allow),
        r("home type it cannot show", raw, true, false, nil, .download),
        r("outside top page", evil, true, true, nil, .cancel),
        r("outside attachment", evil, true, false, "attachment", .cancel),
        r("app as top page", app, true, true, nil, .cancel),
        r("app frame", app, false, true, nil, .allow),
        r("app frame download", app, false, true, "attachment", .download),
        r("home in a frame", home, false, true, nil, .cancel),
        r("outside in a frame", evil, false, true, nil, .cancel),
        r("no address", nil, true, true, nil, .cancel),
    ]
}

private func localDownloadChecks() -> [Check] {
    func d(_ name: String, _ address: String, _ scheme: String, _ host: String, _ port: Int, _ want: Bool) -> Check {
        Check(name: "nav: local download \(name) -> \(want ? "allowed" : "refused")") {
            let got = policy.mayDownloadLocal(URL(string: address)!, fromScheme: scheme, host: host, port: port)
            try expect(got == want, "got \(got)")
        }
    }
    return [
        d("home blob from home", "blob:http://127.0.0.1:3200/5d1c", "http", "127.0.0.1", 3200, true),
        d("app blob from its app", "blob:http://127.0.0.1:3171/5d1c", "http", "127.0.0.1", 3171, true),
        d("another app's blob", "blob:http://127.0.0.1:3172/5d1c", "http", "127.0.0.1", 3171, false),
        d("home blob from an app", "blob:http://127.0.0.1:3200/5d1c", "http", "127.0.0.1", 3171, false),
        d("outside blob from home", "blob:https://evil.example/5d1c", "http", "127.0.0.1", 3200, false),
        d("data from home", "data:text/plain,hi", "http", "127.0.0.1", 3200, true),
        d("data from outside", "data:text/plain,hi", "https", "evil.example", 443, false),
        d("blob from outside", "blob:https://evil.example/5d1c", "https", "evil.example", 443, false),
        d("file from home", "file:///etc/hosts", "http", "127.0.0.1", 3200, false),
        d("home page itself", "http://127.0.0.1:3200/", "http", "127.0.0.1", 3200, false),
    ]
}

private func messageChecks() -> [Check] {
    [
        Check(name: "web: page message keeps plain text") {
            try expect(PageMessage.clean("Saved.\nDone") == "Saved.\nDone", "changed")
        },
        Check(name: "web: page message drops control and direction characters") {
            let got = PageMessage.clean("a\u{0}b\u{7}c\u{1B}[31md\u{202E}e\u{2066}f\u{7F}g\r\th")
            try expect(got == "abc[31mdefgh", "got \(got.debugDescription)")
        },
        Check(name: "web: page message cut to 500 characters") {
            let got = PageMessage.clean(String(repeating: "x", count: 600))
            try expect(got.count == 500 && got.hasSuffix("…"), "length \(got.count)")
            try expect(PageMessage.clean(String(repeating: "y", count: 500)).count == 500, "500 cut")
        },
        Check(name: "web: log words name a known scheme or other") {
            try expect(NavMapping.schemeWord(URL(string: "https://e.x/secret-path")) == "https", "https")
            try expect(NavMapping.schemeWord(URL(string: "x-evil-text-here:1")) == "other", "other")
            try expect(NavMapping.schemeWord(nil) == "other", "nil")
        },
    ]
}

private func factoryChecks() -> [Check] {
    func made(_ role: WebViewRole, _ body: @MainActor (WKWebView) throws -> Void) throws {
        try MainActor.assumeIsolated { try body(WebViewFactory.make(homePort: 3200, role: role)) }
    }
    return [
        Check(name: "web: factory settings of 4.3b") {
            try made(.app) { web in
                let c = web.configuration
                try expect(c.preferences.javaScriptCanOpenWindowsAutomatically == false, "windows")
                try expect(c.preferences.isFraudulentWebsiteWarningEnabled == false, "fraud lookups")
                try expect(c.preferences.isElementFullscreenEnabled, "full screen")
                try expect(c.websiteDataStore.isPersistent, "data store")
                try expect(c.applicationNameForUserAgent == "CompanyEngine/\(BuildConstants.version)", "user agent")
                try expect(!web.allowsLinkPreview, "link preview")
                try expect(web.allowsBackForwardNavigationGestures, "swipe")
                try expect(web.allowsMagnification, "magnification")
                try expect(web.isInspectable == (BuildConstants.flavor == "dev"), "inspectable")
            }
        },
        Check(name: "web: factory adds no script and no handler (S3)") {
            try made(.app) { web in
                try expect(web.configuration.userContentController.userScripts.isEmpty, "a script")
                try expect(web.configuration.urlSchemeHandler(forURLScheme: "companyengine") == nil, "a scheme handler")
            }
        },
        Check(name: "web: factory sets the guard as both delegates") {
            try made(.app) { web in
                guard let g = WebViewFactory.webGuard(of: web) else { throw WebCheckFailure(description: "no guard") }
                try expect(web.navigationDelegate === g && web.uiDelegate === g, "delegates")
                try expect(g.policy.homePort == 3200 && g.role == .app, "policy")
                try expect(g.opener is WorkspaceOpener, "app opener")
                try expect(g.dropped == 0, "count")
            }
        },
        Check(name: "web: probe role records instead of opening") {
            try made(.probe) { web in
                guard let g = WebViewFactory.webGuard(of: web) else { throw WebCheckFailure(description: "no guard") }
                try expect(g.opener is RecordingOpener && g.panels is RecordingPanels, "probe doors")
            }
        },
        Check(name: "web: probe panels answer cancel and record") {
            try MainActor.assumeIsolated {
                let p = RecordingPanels()
                var files: [URL]? = [URL(fileURLWithPath: "/")], save: URL? = URL(fileURLWithPath: "/"), ok = true
                p.chooseFiles(multiple: true, directories: false) { files = $0 }
                p.chooseSaveLocation(suggestedName: "a.pdf") { save = $0 }
                p.showPageMessage("x", confirm: true) { ok = $0 }
                try expect(files == nil && save == nil && !ok, "an answer was not cancel")
                try expect(p.asked == ["open", "save", "confirm"], "asked \(p.asked)")
                let o = RecordingOpener()
                o.open(URL(string: "https://example.com/")!)
                try expect(o.asked.count == 1, "opener")
            }
        },
    ]
}

// PLAN-MAC-2 N4a: the home screen's address as one value, and the `home:` forms the same as `homePort:`.
private func originChecks() -> [Check] {
    let home = HomeOrigin.local(port: 3200)
    func url(_ rest: String, _ want: String?) -> Check {
        Check(name: "origin: url(\(rest.debugDescription)) -> \(want ?? "nil")") {
            let got = home.url(rest)?.absoluteString
            try expect(got == want, "got \(got ?? "nil")")
        }
    }
    return [
        Check(name: "origin: local(port:) is http on the loopback address") {
            try expect(home.scheme == "http" && home.host == HomeOrigin.loopbackHost && home.port == 3200, "\(home)")
            try expect(HomeOrigin.loopbackHost == "127.0.0.1", "loopback")
            try expect(home == .local(port: 3200) && home != .local(port: 3201), "equality")
        },
        url("/", "http://127.0.0.1:3200/"),
        url("/#/needs-you", "http://127.0.0.1:3200/#/needs-you"),
        url("/api/shell", "http://127.0.0.1:3200/api/shell"),
        url("/healthz", "http://127.0.0.1:3200/healthz"),
        url("needs-you", nil),
        url("//evil.example/", nil),
        url("/\n", nil),
        url("", nil),
        url("/ x", nil),
        url("/\\evil.example/", nil),
        url("/@evil.example/", "http://127.0.0.1:3200/@evil.example/"),
        Check(name: "origin: the policy's home: and homePort: forms are the same policy") {
            let a = NavigationPolicy(home: home), b = NavigationPolicy(homePort: 3200)
            try expect(a.home == b.home && a.homePort == 3200 && b.homePort == 3200, "home")
            for text in ["http://127.0.0.1:3200/", "http://127.0.0.1:3201/", "http://localhost:3200/",
                         "https://127.0.0.1:3200/", "http://127.0.0.1:03200/"] {
                let u = URL(string: text)!
                try expect(a.isHome(u) == b.isHome(u), text)
            }
            try expect(a.isHome(home.url("/#/needs-you")!), "its own address is home")
        },
        Check(name: "origin: the poll's home: and homePort: forms are the same") {
            let a = Poller(home: home, timeout: 1), b = Poller(homePort: 3200, timeout: 1)
            try expect(a.home == b.home && a.homePort == 3200 && b.homePort == 3200, "home")
        },
        Check(name: "origin: the factory's home: form gives the policy that origin") {
            try MainActor.assumeIsolated {
                let web = WebViewFactory.make(home: .local(port: 3333), role: .probe)
                guard let g = WebViewFactory.webGuard(of: web) else { throw WebCheckFailure(description: "no guard") }
                try expect(g.policy.home == .local(port: 3333) && g.policy.homePort == 3333, "policy")
            }
        },
    ]
}

func webChecks() -> [Check] {
    tableChecks() + hostileChecks() + mappingChecks() + responseChecks() + localDownloadChecks() + messageChecks() + factoryChecks()
        + originChecks()
}
