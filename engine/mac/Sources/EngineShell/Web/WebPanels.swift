import AppKit

// The two doors out of the web view that the app (M5) or the probe (M4) fills in.

/// Every address that leaves the app goes through `open`, and only after `NavigationPolicy` said `external`.
@MainActor
public protocol ExternalOpener: AnyObject {
    func open(_ url: URL)
}

/// The panels a page can ask for. The app shows real ones (M5); the probe answers "cancel" to all.
@MainActor
public protocol WebPanels: AnyObject {
    /// `<input type=file>`: an open panel; nil when the owner cancels.
    func chooseFiles(multiple: Bool, directories: Bool, completion: @escaping @MainActor ([URL]?) -> Void)
    /// A download: a save panel (default folder ~/Downloads, the name passed through SafeName.clean,
    /// the panel's own question before replacing a file); nil when the owner cancels.
    func chooseSaveLocation(suggestedName: String, completion: @escaping @MainActor (URL?) -> Void)
    /// `alert` (confirm false) or `confirm` (true) from the home page itself: a sheet under the fixed
    /// heading W12 with `text` as plain text (already cleaned by PageMessage). true is "OK".
    func showPageMessage(_ text: String, confirm: Bool, completion: @escaping @MainActor (Bool) -> Void)
}

/// The app's opener: the default browser, through the system. Checks the address once more.
@MainActor
public final class WorkspaceOpener: ExternalOpener {
    public init() {}
    public func open(_ url: URL) {
        guard NavigationPolicy.mayOpenOutside(url) else { return }
        NSWorkspace.shared.open(url)
    }
}

/// The probe's opener: records what would have opened and opens nothing.
@MainActor
public final class RecordingOpener: ExternalOpener {
    public private(set) var asked: [URL] = []
    public init() {}
    public func open(_ url: URL) { asked.append(url) }
}

/// Answers "cancel" to every panel and records which were asked for. The probe's panels, and the app's
/// until it sets its own.
@MainActor
public final class RecordingPanels: WebPanels {
    public private(set) var asked: [String] = []
    public init() {}
    public func chooseFiles(multiple: Bool, directories: Bool, completion: @escaping @MainActor ([URL]?) -> Void) {
        asked.append("open"); completion(nil)
    }
    public func chooseSaveLocation(suggestedName: String, completion: @escaping @MainActor (URL?) -> Void) {
        asked.append("save"); completion(nil)
    }
    public func showPageMessage(_ text: String, confirm: Bool, completion: @escaping @MainActor (Bool) -> Void) {
        asked.append(confirm ? "confirm" : "alert"); completion(false)
    }
}
