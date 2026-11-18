import Foundation

/// The home screen's address as one value (PLAN-MAC-2 N4a). Its only constructor is `.local(port:)`:
/// http on the loopback address, so the address is still compiled in (S1). This file holds the only
/// loopback string literal in EngineShell and CompanyEngine; a remote address later is a new constructor
/// and a new review, not a hunt through the code.
public struct HomeOrigin: Equatable, Sendable {
    public static let loopbackHost = "127.0.0.1"

    public let scheme: String
    public let host: String
    public let port: Int

    private init(scheme: String, host: String, port: Int) {
        self.scheme = scheme; self.host = host; self.port = port
    }

    public static func local(port: Int) -> HomeOrigin {
        HomeOrigin(scheme: "http", host: loopbackHost, port: port)
    }

    /// An address on this origin. `rest` starts with exactly one "/" ("/", "/#/needs-you", "/api/shell",
    /// "/healthz") and holds no space, control or direction character; anything else, or anything that
    /// parses to another scheme, host or port, is nil.
    public func url(_ rest: String) -> URL? {
        guard rest.hasPrefix("/"), !rest.hasPrefix("//"), !rest.contains("\\"),
              NavigationPolicy.isClean(rest) else { return nil }
        guard let url = URL(string: "\(scheme)://\(host):\(port)\(rest)"),
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == scheme, parts.encodedHost == host, parts.port == port,
              parts.percentEncodedUser == nil, parts.percentEncodedPassword == nil else { return nil }
        return url
    }
}
