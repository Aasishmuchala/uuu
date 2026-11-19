import Foundation

// Where the web view may go (PLAN-MAC 4.3, S1 to S4). Everything here is pure: no WebKit, no window.
// Every address is treated as written by an agent (ADR 0007): parsed once, compared part by part,
// never matched as a string prefix or a pattern over the whole address.

public struct NavRequest {
    public var url: URL
    public var mainFrame: Bool
    public var click: Bool
    public var newWindow: Bool
    /// The port of the one App Studio app the asker is held to; nil only when the home page itself asked
    /// (`NavMapping.request` decides which, M16b).
    public var fromAppPort: Int?
    /// The asker is not the home page and its own app is not known: no app's port matches it.
    public static let unknownApp = 0
    public init(url: URL, mainFrame: Bool, click: Bool, newWindow: Bool, fromAppPort: Int? = nil) {
        self.url = url; self.mainFrame = mainFrame; self.click = click; self.newWindow = newWindow
        self.fromAppPort = fromAppPort
    }
}

public enum NavVerdict: Equatable {
    case allow
    case external(URL)
    case drop
    case download
}

/// The parts of an address the rules look at, taken from the parsed address only.
struct Address {
    let scheme: String
    let host: String?        // as written, percent-encoding kept
    let portText: String?    // the digits as written, so 03200 is not 3200
    let port: Int?
    let hasCredentials: Bool
    let text: String

    init?(_ url: URL) {
        let text = url.absoluteString
        guard let parts = URLComponents(string: text), let scheme = parts.scheme else { return nil }
        self.scheme = scheme
        self.host = parts.encodedHost   // as written: punycode stays punycode, %xx stays %xx
        self.port = parts.port
        if let range = parts.rangeOfPort, let whole = parts.string {
            self.portText = String(whole[range])
        } else {
            self.portText = nil
        }
        self.hasCredentials = parts.percentEncodedUser != nil || parts.percentEncodedPassword != nil
        self.text = text
    }

    /// `http`, the host exactly `127.0.0.1`, the port written exactly as `port`, no user name or password.
    func isLoopbackHTTP(port wanted: ClosedRange<Int>) -> Bool {
        isOrigin(scheme: "http", host: HomeOrigin.loopbackHost, port: wanted)
    }

    /// The scheme and host exactly as given, the port written exactly as one in `wanted`, no user name or
    /// password.
    func isOrigin(scheme wantedScheme: String, host wantedHost: String, port wanted: ClosedRange<Int>) -> Bool {
        guard scheme == wantedScheme, host == wantedHost, !hasCredentials,
              let port, wanted.contains(port), portText == String(port) else { return false }
        return true
    }
}

public struct NavigationPolicy {
    public let home: HomeOrigin
    public var homePort: Int { home.port }
    public init(home: HomeOrigin) { self.home = home }
    public init(homePort: Int) { self.init(home: .local(port: homePort)) }

    /// App Studio's apps, each on its own port (ADR 0016). Only ever inside a frame.
    public static let appPorts = 3171...3189
    /// S4: the longest address that may be handed to the default browser.
    public static let externalMaxLength = 2_048

    public func decide(_ request: NavRequest) -> NavVerdict {
        let url = request.url
        // A new window is never made inside the app: it is the owner's browser or nothing.
        if request.newWindow {
            return request.click && Self.mayOpenOutside(url) ? .external(url) : .drop
        }
        if request.mainFrame {
            if isHome(url) { return .allow }
            return request.click && Self.mayOpenOutside(url) ? .external(url) : .drop
        }
        // A frame inside the home page: an app's own address, or the empty page a frame starts with.
        if Self.isAboutBlank(url) { return .allow }
        guard Self.isAppFrame(url) else { return .drop }
        // An app's frame may move itself only within its own port, never to another app's page under its
        // name (M15, L5). The home page may open any app; any other asker is held to one app (M16b).
        if let from = request.fromAppPort, URLComponents(string: url.absoluteString)?.port != from { return .drop }
        return .allow
    }

    /// The home screen's own origin: the only top page the app shows (S1).
    public func isHome(_ url: URL) -> Bool {
        guard Self.isClean(url.absoluteString), let a = Address(url) else { return false }
        return a.isOrigin(scheme: home.scheme, host: home.host, port: home.port...home.port)
    }

    /// An App Studio app's address, http://127.0.0.1:3171 to 3189 (S2).
    public static func isAppFrame(_ url: URL) -> Bool {
        guard isClean(url.absoluteString), let a = Address(url) else { return false }
        return a.isLoopbackHTTP(port: appPorts)
    }

    public static func isAboutBlank(_ url: URL) -> Bool {
        url.absoluteString == "about:blank"
    }

    /// S4, the address half (the click is the caller's): http or https written in lower case, a host
    /// with no percent sign, no user name or password, at most 2,048 characters, nothing invisible.
    public static func mayOpenOutside(_ url: URL) -> Bool {
        let text = url.absoluteString
        guard text.count <= externalMaxLength, isClean(text), let a = Address(url) else { return false }
        guard a.scheme == "http" || a.scheme == "https" else { return false }
        guard let host = a.host, !host.isEmpty, !host.contains("%"), !a.hasCredentials else { return false }
        if let portText = a.portText, portText.isEmpty || a.port == nil { return false }
        if let port = a.port, !(1...65_535).contains(port) { return false }
        return true
    }

    /// The origin of a frame as WebKit reports it (WKSecurityOrigin's protocol, host and port).
    public func isHomeOrigin(scheme: String, host: String, port: Int) -> Bool {
        scheme == home.scheme && host == home.host && port == home.port
    }

    public static func isAppOrigin(scheme: String, host: String, port: Int) -> Bool {
        scheme == "http" && host == HomeOrigin.loopbackHost && appPorts.contains(port)
    }

    /// A `download` link to a `blob:` or `data:` address the page or app made itself. Allowed only from
    /// the home page or an app's frame, and a blob only when it belongs to that same origin. The file
    /// still goes only where the owner's save panel says.
    public func mayDownloadLocal(_ url: URL, fromScheme scheme: String, host: String, port: Int) -> Bool {
        let fromHome = isHomeOrigin(scheme: scheme, host: host, port: port)
        guard fromHome || Self.isAppOrigin(scheme: scheme, host: host, port: port) else { return false }
        let text = url.absoluteString
        if text.hasPrefix("data:") { return true }
        guard text.hasPrefix("blob:"), let inner = URL(string: String(text.dropFirst(5))),
              Self.isClean(inner.absoluteString), let a = Address(inner) else { return false }
        return a.isLoopbackHTTP(port: port...port)
    }

    /// No control, space or direction-override character anywhere in the address.
    static func isClean(_ text: String) -> Bool {
        for u in text.unicodeScalars {
            switch u.value {
            case 0x00...0x20, 0x7F, 0x80...0x9F, 0x200E, 0x200F, 0x202A...0x202E, 0x2066...0x2069: return false
            default: continue
            }
        }
        return true
    }
}

/// What to do with an answer from the server, once a load was let through (4.3b).
public enum ResponseOutcome: Equatable { case allow, download, cancel }

extension NavigationPolicy {
    /// Only an answer from an allowed address is shown: the home page in the top frame, an app's
    /// address in a frame. A redirect that slipped past the action check still ends here.
    public func respond(url: URL?, mainFrame: Bool, canShowMIMEType: Bool, contentDisposition: String?) -> ResponseOutcome {
        guard let url else { return .cancel }
        let allowed = mainFrame ? isHome(url) : (Self.isAppFrame(url) || Self.isAboutBlank(url))
        guard allowed else { return .cancel }
        if let disposition = contentDisposition?.trimmingCharacters(in: .whitespaces).lowercased(),
           disposition.hasPrefix("attachment") { return .download }
        return canShowMIMEType ? .allow : .download
    }
}

/// The text of a page's `alert` or `confirm`, shown as plain text under the fixed heading W12:
/// control and direction-override characters removed (line breaks kept), cut to 500 characters.
public enum PageMessage {
    public static let maxLength = 500

    public static func clean(_ s: String) -> String {
        var scalars = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            switch u.value {
            case 0x0A: scalars.append(u)
            case 0x00...0x1F, 0x7F, 0x80...0x9F, 0x200E, 0x200F, 0x202A...0x202E, 0x2066...0x2069: continue
            default: scalars.append(u)
            }
        }
        let text = String(scalars)
        guard text.count > maxLength else { return text }
        return String(text.prefix(maxLength - 1)) + "…"
    }
}
