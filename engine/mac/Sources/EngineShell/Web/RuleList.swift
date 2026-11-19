import WebKit
import os

/// The web view's second fence (PLAN-MAC D16, PLAN-MAC-2 M8): a WebKit content rule list that blocks every load, in
/// every frame, whose address is not the home screen's origin or an App Studio app's (the same loopback host, ports
/// 3171 to 3189). The first fence stays where it is: NavigationPolicy for where a frame may go, and the frame's own
/// sandbox and App Studio's headers for what an app's page may do. A rule list does not see WebRTC.
///
/// `Rules.json` beside this file is the list's shape and names no host: one rule that blocks everything, then two
/// "let through" rules written for `{origin}` (its addresses, and the `blob:` addresses its own pages make, which
/// never leave the Mac), each repeated for every allowed origin. Every origin is a
/// `HomeOrigin.local(port:)`, so the only host the compiled list can name is `HomeOrigin.loopbackHost`.
/// `template` is that file's text, held here because the app bundle carries no resource folder; a check keeps the two
/// the same.
public enum RuleList {
    public static let template = """
    [
      {"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
      {"trigger": {"url-filter": "^{origin}/"}, "action": {"type": "ignore-previous-rules"}},
      {"trigger": {"url-filter": "^blob:{origin}/"}, "action": {"type": "ignore-previous-rules"}}
    ]

    """

    /// The word in `template` that stands for one allowed origin.
    public static let originToken = "{origin}"

    /// The origins let through: the home's, then one for each frame port, every one on the loopback host.
    public static func origins(home: HomeOrigin, framePorts: [Int]) -> [HomeOrigin] {
        var out = [home]
        for p in framePorts where !out.contains(where: { $0.port == p }) { out.append(.local(port: p)) }
        return out
    }

    /// `scheme://host:port`, written for a url-filter: every character a pattern would read as more than itself is
    /// escaped (a dot matches only a dot).
    public static func pattern(_ origin: HomeOrigin) -> String {
        let text = "\(origin.scheme)://\(origin.host):\(origin.port)"
        var out = ""
        for c in text {
            if c.isLetter || c.isNumber || c == ":" || c == "/" { out.append(c) } else { out.append("\\"); out.append(c) }
        }
        return out
    }

    /// The list WebKit compiles: `template` with its `{origin}` rule written once for each origin of `origins`. The app
    /// always uses App Studio's ports; only the frames trial (a test tool) adds the port of its own stand-in app.
    /// nil only if the template were not a JSON list of rules.
    public static func json(home: HomeOrigin, framePorts: [Int] = Array(NavigationPolicy.appPorts)) -> String? {
        guard let data = template.data(using: .utf8),
              let rules = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return nil }
        var out: [[String: Any]] = []
        for rule in rules {
            guard let trigger = rule["trigger"] as? [String: Any], let filter = trigger["url-filter"] as? String,
                  filter.contains(originToken) else { out.append(rule); continue }
            for origin in origins(home: home, framePorts: framePorts) {
                var t = trigger
                t["url-filter"] = filter.replacingOccurrences(of: originToken, with: pattern(origin))
                var r = rule
                r["trigger"] = t
                out.append(r)
            }
        }
        guard let encoded = try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .withoutEscapingSlashes]) else {
            return nil
        }
        return String(data: encoded, encoding: .utf8)
    }

    private static let log = Logger(subsystem: "local.uuu.company-engine", category: "web")
    @MainActor private static var made: [Int: WKContentRuleList] = [:]

    /// The app's list for `home`, compiled once and then kept. nil only when WebKit could not compile it; the web view
    /// then has its first fence only, and a log line says so.
    @MainActor
    public static func compiled(for home: HomeOrigin) -> WKContentRuleList? {
        if let list = made[home.port] { return list }
        guard let text = json(home: home) else { log.error("rule list: the template is not a list"); return nil }
        guard let list = compile(text, identifier: "local.uuu.company-engine.rules.\(home.port)") else {
            log.error("rule list: WebKit did not compile it; the web view keeps its navigation rules only")
            return nil
        }
        made[home.port] = list
        return list
    }

    /// Compiles `text` into WebKit's own store, waiting for the answer (at most `seconds`) so that a web view never
    /// loads a page before its list is on. WebKit answers on the main thread; the wait lets the run loop turn.
    @MainActor
    public static func compile(_ text: String, identifier: String, within seconds: TimeInterval = 10) -> WKContentRuleList? {
        final class Answer { var list: WKContentRuleList?; var done = false }
        let answer = Answer()
        guard let store = WKContentRuleListStore.default() else { return nil }
        store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: text) { list, _ in
            answer.list = list
            answer.done = true
        }
        let end = Date().addingTimeInterval(seconds)
        while !answer.done && Date() < end {
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
        }
        return answer.list
    }
}
