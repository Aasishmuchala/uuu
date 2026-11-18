import AppKit
import EngineShell

// 4.3b: the panels a page may ask for. Files go in only through the owner's open panel; a download goes
// only where the owner's save panel says, under a cleaned name, and is never opened by the app. A page's
// `alert` or `confirm` is a sheet under the fixed heading W12, its text plain.
@MainActor
final class AppPanels: WebPanels {
    private weak var window: NSWindow?

    init(window: NSWindow) { self.window = window }

    func chooseFiles(multiple: Bool, directories: Bool, completion: @escaping @MainActor ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = directories
        panel.allowsMultipleSelection = multiple
        panel.resolvesAliases = true
        panel.canCreateDirectories = false
        present(panel) { ok in completion(ok ? panel.urls : nil) }
    }

    func chooseSaveLocation(suggestedName: String, completion: @escaping @MainActor (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = SafeName.clean(suggestedName)
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        present(panel) { ok in
            guard ok, let url = panel.url else { return completion(nil) }
            // The panel has already asked before replacing a file. A download cannot be written over a file
            // that is there, so the old one goes to the Trash (never deleted outright).
            if FileManager.default.fileExists(atPath: url.path) {
                do { try FileManager.default.trashItem(at: url, resultingItemURL: nil) } catch { return completion(nil) }
            }
            completion(url)
        }
    }

    func showPageMessage(_ text: String, confirm: Bool, completion: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = NativeWords.pageMessageHeading
        alert.informativeText = text
        alert.addButton(withTitle: "OK")
        if confirm { alert.addButton(withTitle: "Cancel") }
        if let window, window.isVisible {
            alert.beginSheetModal(for: window) { response in completion(response == .alertFirstButtonReturn) }
        } else {
            completion(alert.runModal() == .alertFirstButtonReturn)
        }
    }

    private func present(_ panel: NSSavePanel, _ done: @escaping @MainActor (Bool) -> Void) {
        if let window, window.isVisible {
            panel.beginSheetModal(for: window) { response in done(response == .OK) }
        } else {
            done(panel.runModal() == .OK)
        }
    }
}
