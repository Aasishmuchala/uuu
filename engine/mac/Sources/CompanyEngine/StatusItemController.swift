import AppKit
import EngineShell

// The menu bar item (section 3): a template glyph and the Needs-you count; its menu holds W14, W13, Start
// or Stop, the three switches of W15, "Open Company Engine" and Quit. Rebuilt each time it opens.
@MainActor
final class StatusItemController: NSObject, NSMenuDelegate {
    private let item: NSStatusItem
    private unowned let app: AppController
    private let menu = NSMenu()

    init(app: AppController) {
        self.app = app
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        if let button = item.button {
            let glyph = NSImage(systemSymbolName: "building.2", accessibilityDescription: NativeWords.appName)
            glyph?.isTemplate = true
            button.image = glyph
            button.imagePosition = .imageLeading
            button.setAccessibilityLabel(NativeWords.appName)
        }
        menu.delegate = self
        menu.autoenablesItems = true
        item.menu = menu
        update(count: nil)
    }

    func update(count: Int?) {
        guard let button = item.button else { return }
        let text = Badge.text(count) ?? ""
        button.title = text
        button.setAccessibilityValue(count.map { $0 == 0 ? NativeWords.nothingNeedsYou : NativeWords.needsYou($0) })
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if let state = app.lastState {
            if let line = EngineLine.needsYou(state) { menu.addItem(disabled(line)) }
            menu.addItem(disabled(EngineLine.text(state)))
            menu.addItem(.separator())
        }
        let engineDown: Bool = {
            guard let state = app.lastState else { return true }
            return state == .down
        }()
        if engineDown {
            menu.addItem(MainMenu.item(NativeWords.start, #selector(AppController.startEngine(_:)), target: app))
        } else {
            menu.addItem(MainMenu.item(NativeWords.stopMenu, #selector(AppController.stopEngine(_:)), target: app))
        }
        menu.addItem(.separator())

        let awake = MainMenu.item(NativeWords.keepAwake, #selector(AppController.toggleKeepAwake(_:)), target: app)
        awake.state = app.keepAwakeOn ? .on : .off
        menu.addItem(awake)
        let note = disabled(NativeWords.keepAwakeNote)
        note.indentationLevel = 1
        menu.addItem(note)

        let notify = MainMenu.item(NativeWords.notifyMe, #selector(AppController.toggleNotify(_:)), target: app)
        notify.state = app.notifyOn && !app.notificationsRefused ? .on : .off
        menu.addItem(notify)
        if app.notificationsRefused {
            let where_ = disabled(NativeWords.notificationsWhere)
            where_.indentationLevel = 1
            menu.addItem(where_)
        }

        if app.isRelease {
            let login = MainMenu.item(NativeWords.openAtLogin, #selector(AppController.toggleOpenAtLogin(_:)), target: app)
            login.state = app.openAtLoginOn ? .on : .off
            menu.addItem(login)
        }
        menu.addItem(.separator())
        menu.addItem(MainMenu.item(NativeWords.openApp, #selector(AppController.showWindow(_:)), target: app))
        menu.addItem(MainMenu.item(NativeWords.quit, #selector(NSApplication.terminate(_:)), key: "q"))
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }
}
