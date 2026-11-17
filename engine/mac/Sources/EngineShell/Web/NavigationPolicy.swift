import Foundation

public struct NavRequest {
    public var url: URL
    public var mainFrame: Bool
    public var click: Bool
    public var newWindow: Bool
    public init(url: URL, mainFrame: Bool, click: Bool, newWindow: Bool) {
        self.url = url; self.mainFrame = mainFrame; self.click = click; self.newWindow = newWindow
    }
}

public enum NavVerdict {
    case allow
    case external(URL)
    case drop
    case download
}

public struct NavigationPolicy {
    public let homePort: Int
    public init(homePort: Int) { self.homePort = homePort }

    public func decide(_ request: NavRequest) -> NavVerdict {
        fatalError("M2")
    }
}
