import Foundation

// 4.5 and D4: the native side's only reading of the engine. Every tick asks `GET /healthz`, then
// `GET /api/shell`, on http://127.0.0.1:<homePort>, through an ephemeral session with no cookies, no cache,
// no proxy and no redirects followed, a time limit per request, and the body cut at 1 MB.
//   up(status)  the home screen answers and its shell reading parsed
//   answering   /healthz answered 200, /api/shell did not give a readable answer
//   down        /healthz did not answer 200, or either answer was a redirect or came from elsewhere
public final class Poller {
    public enum State: Equatable { case up(ShellStatus), answering, down }

    public let homePort: Int
    public let timeout: TimeInterval
    private let session: URLSession
    private let fetcher: Fetcher
    private var timer: Timer?
    private var inFlight = false

    public static func interval(windowOpen: Bool) -> TimeInterval { windowOpen ? 20 : 30 }

    public init(homePort: Int, timeout: TimeInterval = 5) {
        self.homePort = homePort
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
        fetcher = Fetcher(port: homePort, limit: ShellStatus.maxBody)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: fetcher, delegateQueue: queue)
    }

    deinit {
        timer?.invalidate()
        session.invalidateAndCancel()
    }

    // One reading; `done` runs on the main queue.
    public func pollOnce(_ done: @escaping (State) -> Void) {
        get("/healthz") { [weak self] health in
            guard let self = self else { return }
            guard case .ok(200, _) = health else { return DispatchQueue.main.async { done(.down) } }
            self.get("/api/shell") { shell in
                let state: State
                switch shell {
                case .ok(200, let body): state = ShellStatus.parse(body).map { .up($0) } ?? .answering
                case .elsewhere: state = .down
                default: state = .answering
                }
                DispatchQueue.main.async { done(state) }
            }
        }
    }

    // A timer on the main run loop; the first reading is taken at once. A tick while a reading is still
    // out is skipped.
    public func start(every interval: TimeInterval, onState: @escaping (State) -> Void) {
        stop()
        let tick: () -> Void = { [weak self] in
            guard let self = self, !self.inFlight else { return }
            self.inFlight = true
            self.pollOnce { state in
                self.inFlight = false
                onState(state)
            }
        }
        let t = Timer(timeInterval: interval, repeats: true) { _ in tick() }
        t.tolerance = min(2, interval / 10)
        RunLoop.main.add(t, forMode: .common)
        timer = t
        tick()
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func get(_ path: String, _ done: @escaping (Fetch) -> Void) {
        guard let url = URL(string: "http://127.0.0.1:\(homePort)\(path)") else { return done(.failed) }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.httpMethod = "GET"
        req.httpShouldHandleCookies = false
        let task = session.dataTask(with: req)
        fetcher.watch(task, done)
        task.resume()
    }
}

enum Fetch {
    case ok(Int, Data)   // a status and a body of at most the limit, from 127.0.0.1:<port>
    case elsewhere       // a redirect, or an answer whose address is not the one asked
    case tooBig
    case failed
}

// The session's delegate: refuses every redirect, cuts the body at the limit, and hands each task's end to
// the closure it was watched with.
final class Fetcher: NSObject, URLSessionDataDelegate {
    private let port: Int
    private let limit: Int
    private let lock = NSLock()
    private var open: [Int: (body: Data, verdict: Fetch?, done: (Fetch) -> Void)] = [:]

    init(port: Int, limit: Int) {
        self.port = port
        self.limit = limit
    }

    func watch(_ task: URLSessionTask, _ done: @escaping (Fetch) -> Void) {
        lock.lock(); open[task.taskIdentifier] = (Data(), nil, done); lock.unlock()
    }

    private func mark(_ task: URLSessionTask, _ verdict: Fetch) {
        lock.lock(); defer { lock.unlock() }
        if var entry = open[task.taskIdentifier], entry.verdict == nil {
            entry.verdict = verdict
            open[task.taskIdentifier] = entry
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        mark(task, .elsewhere)
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, let url = http.url,
              url.scheme == "http", url.host == "127.0.0.1", url.port == port else {
            mark(dataTask, .elsewhere)
            return completionHandler(.cancel)
        }
        if (300...399).contains(http.statusCode) {
            mark(dataTask, .elsewhere)
            return completionHandler(.cancel)
        }
        if http.expectedContentLength > Int64(limit) {
            mark(dataTask, .tooBig)
            return completionHandler(.cancel)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        var cut = false
        if var entry = open[dataTask.taskIdentifier], entry.verdict == nil {
            if entry.body.count + data.count > limit {
                entry.verdict = .tooBig
                entry.body = Data()
                cut = true
            } else {
                entry.body.append(data)
            }
            open[dataTask.taskIdentifier] = entry
        }
        lock.unlock()
        if cut { dataTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let entry = open.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let entry = entry else { return }
        let result: Fetch
        if let verdict = entry.verdict {
            result = verdict
        } else if error != nil {
            result = .failed
        } else if let http = task.response as? HTTPURLResponse {
            result = .ok(http.statusCode, entry.body)
        } else {
            result = .failed
        }
        entry.done(result)
    }
}
