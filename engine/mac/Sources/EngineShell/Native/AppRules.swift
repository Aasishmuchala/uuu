import Foundation

// The app's small pure rules (PLAN-MAC section 3, 4.7, D10, D11, D14), here so the checks run them without
// a window. The app's controllers only carry them out.

/// Section 3: the Go menu. Cmd-1 to Cmd-6, each one page of the home screen; nothing else is added.
public struct GoRoute: Equatable {
    public let title: String
    public let key: String
    public let path: String

    public static let all: [GoRoute] = [
        GoRoute(title: "Map", key: "1", path: "/#/map"),
        GoRoute(title: "Needs you", key: "2", path: "/#/needs-you"),
        GoRoute(title: "Tasks", key: "3", path: "/#/tasks"),
        GoRoute(title: "Dashboards", key: "4", path: "/#/dashboards"),
        GoRoute(title: "Files", key: "5", path: "/#/files"),
        GoRoute(title: "Jobs", key: "6", path: "/#/jobs"),
    ]
    /// Cmd-comma, and the one item of the Help menu.
    public static let settings = "/#/settings"
    public static let health = "/#/health"
    public static let needsYou = "/#/needs-you"
    public static let home = "/"
}

/// W13 and W14 from one reading of the poll.
public enum EngineLine {
    /// "on" when the home screen answers with the board and the gate on; "needs attention" when it answers
    /// but either is not on, or its reading cannot be read; "off" when it does not answer.
    public static func text(_ state: Poller.State) -> String {
        switch state {
        case .up(let s): return s.board == .on && s.gate == .on ? NativeWords.engineOn : NativeWords.engineAttention
        case .answering: return NativeWords.engineAttention
        case .down: return NativeWords.engineOff
        }
    }

    /// Only while the home screen answers with a count.
    public static func needsYou(_ state: Poller.State) -> String? {
        guard case .up(let s) = state else { return nil }
        return s.needsYou == 0 ? NativeWords.nothingNeedsYou : NativeWords.needsYou(s.needsYou)
    }

    public static func count(_ state: Poller.State) -> Int? {
        guard case .up(let s) = state else { return nil }
        return s.needsYou
    }
}

/// D11: what the off page says. The title and the line are always W2 and W3; under the button, the one
/// sentence that applies, in this order: the switch cannot be used (W8 or W10), the engine is starting
/// (W5), the home screen answers but its page will not load (W16).
public struct OffPageText: Equatable {
    public let title: String
    public let line: String
    public let note: String?
    public let startEnabled: Bool

    public static func make(_ state: SwitchState, starting: Bool, notAnswering: Bool) -> OffPageText {
        if case .unavailable(let sentence) = state {
            return OffPageText(title: NativeWords.offTitle, line: NativeWords.offLine, note: sentence, startEnabled: false)
        }
        if starting {
            return OffPageText(title: NativeWords.offTitle, line: NativeWords.offLine, note: NativeWords.starting, startEnabled: false)
        }
        return OffPageText(title: NativeWords.offTitle, line: NativeWords.offLine,
                           note: notAnswering ? NativeWords.notAnswering : nil, startEnabled: true)
    }
}

/// D14: the title bar follows the page's colour behind its content: dark when that colour is dark.
public enum TitleTint {
    /// Darker than middle grey: relative luminance (sRGB, 0 to 1 per part) under 0.18, which is L* 50.
    public static func isDark(red: Double, green: Double, blue: Double) -> Bool {
        func lin(_ c: Double) -> Double {
            let c = min(1, max(0, c))
            return c <= 0.040_45 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let y = 0.2126 * lin(red) + 0.7152 * lin(green) + 0.0722 * lin(blue)
        return y < 0.18
    }
}

/// D10: the app compares its compiled version with `<root>/engine/mac/VERSION` (one line, S7).
public enum VersionFile {
    public static func read(root: String) -> String? {
        guard root.hasPrefix("/") else { return nil }
        let path = (root as NSString).appendingPathComponent("engine/mac/VERSION")
        guard let handle = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? handle.close() }
        let data = (try? handle.read(upToCount: 64)) ?? Data()
        return firstLine(data)
    }

    /// The first line, without spaces; nil when empty or not a version made of digits and dots.
    public static func firstLine(_ data: Data) -> String? {
        let text = String(decoding: data, as: UTF8.self)
        let line = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
        let v = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, v.count <= 32, v.allSatisfy({ $0.isASCII && ($0.isNumber || $0 == ".") }) else { return nil }
        return v
    }

    /// Stale only when the repository's version can be read and differs from the compiled one.
    public static func isStale(compiled: String, root: String) -> Bool {
        guard let there = read(root: root) else { return false }
        return there != compiled
    }
}

/// D11: is the home screen there? `GET /healthz` on the home origin, answered 200 within the time limit,
/// through the poll's own fetcher (no cookies, no cache, no proxy, no redirect followed).
public final class HealthProbe {
    private let home: HomeOrigin
    private let timeout: TimeInterval
    private let session: URLSession
    private let fetcher: Fetcher

    public init(home: HomeOrigin, timeout: TimeInterval = 1.5) {
        self.home = home
        self.timeout = timeout
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.connectionProxyDictionary = [
            kCFNetworkProxiesHTTPEnable as String: 0,
            kCFNetworkProxiesHTTPSEnable as String: 0,
            kCFNetworkProxiesSOCKSEnable as String: 0,
            kCFNetworkProxiesProxyAutoConfigEnable as String: 0,
            kCFNetworkProxiesProxyAutoDiscoveryEnable as String: 0,
        ]
        config.timeoutIntervalForRequest = timeout
        config.timeoutIntervalForResource = timeout
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 1
        fetcher = Fetcher(home: home, limit: 64 * 1024)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: fetcher, delegateQueue: queue)
    }

    deinit { session.invalidateAndCancel() }

    /// `done` runs on the main queue with true only for a 200 from the home origin.
    public func check(_ done: @escaping (Bool) -> Void) {
        guard let url = home.url("/healthz") else { return DispatchQueue.main.async { done(false) } }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.httpMethod = "GET"
        req.httpShouldHandleCookies = false
        let task = session.dataTask(with: req)
        fetcher.watch(task) { result in
            let ok: Bool
            if case .ok(200, _) = result { ok = true } else { ok = false }
            DispatchQueue.main.async { done(ok) }
        }
        task.resume()
    }
}
