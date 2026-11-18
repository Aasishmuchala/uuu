import AppKit
import EngineShell

// Section 3: App, Edit, View, Go, Engine, Window, Help. The app binds no key the web pages use (Cmd-K, "/",
// "c", "q", "[", "g", Esc stay the page's). Edit is what makes copy and paste work in the web view.
@MainActor
enum MainMenu {
    static func item(_ title: String, _ action: Selector?, key: String = "",
                     mods: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        if !key.isEmpty { item.keyEquivalentModifierMask = mods }
        item.target = target
        return item
    }

    private static func submenu(_ main: NSMenu, _ menu: NSMenu) {
        let holder = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        holder.submenu = menu
        main.addItem(holder)
    }

    static func make(target: AppController, engineMenu: NSMenu) -> NSMenu {
        let main = NSMenu()
        let name = NativeWords.appName

        let app = NSMenu(title: name)
        app.addItem(item("About \(name)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))))
        app.addItem(.separator())
        app.addItem(item("Settings…", #selector(AppController.openSettings(_:)), key: ",", target: target))
        app.addItem(.separator())
        app.addItem(item("Hide \(name)", #selector(NSApplication.hide(_:)), key: "h"))
        app.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), key: "h", mods: [.command, .option]))
        app.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:))))
        app.addItem(.separator())
        app.addItem(item(NativeWords.quit, #selector(NSApplication.terminate(_:)), key: "q"))
        submenu(main, app)

        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", Selector(("undo:")), key: "z"))
        edit.addItem(item("Redo", Selector(("redo:")), key: "z", mods: [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Cut", #selector(NSText.cut(_:)), key: "x"))
        edit.addItem(item("Copy", #selector(NSText.copy(_:)), key: "c"))
        edit.addItem(item("Paste", #selector(NSText.paste(_:)), key: "v"))
        edit.addItem(item("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), key: "v",
                          mods: [.command, .option, .shift]))
        edit.addItem(item("Delete", #selector(NSText.delete(_:))))
        edit.addItem(item("Select All", #selector(NSText.selectAll(_:)), key: "a"))
        submenu(main, edit)

        let view = NSMenu(title: "View")
        view.addItem(item("Reload Page", #selector(AppController.reloadPage(_:)), key: "r", target: target))
        view.addItem(.separator())
        view.addItem(item("Actual Size", #selector(AppController.actualSize(_:)), key: "0", target: target))
        view.addItem(item("Zoom In", #selector(AppController.zoomIn(_:)), key: "+", target: target))
        let zoomInAlt = item("Zoom In", #selector(AppController.zoomIn(_:)), key: "=", target: target)
        zoomInAlt.isHidden = true
        zoomInAlt.allowsKeyEquivalentWhenHidden = true
        view.addItem(zoomInAlt)
        view.addItem(item("Zoom Out", #selector(AppController.zoomOut(_:)), key: "-", target: target))
        view.addItem(.separator())
        view.addItem(item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), key: "f", mods: [.command, .control]))
        submenu(main, view)

        let go = NSMenu(title: "Go")
        go.addItem(item("Back", #selector(AppController.goBack(_:)), key: "[", target: target))
        go.addItem(item("Forward", #selector(AppController.goForward(_:)), key: "]", target: target))
        go.addItem(.separator())
        for route in GoRoute.all {
            let i = item(route.title, #selector(AppController.goRoute(_:)), key: route.key, target: target)
            i.representedObject = route.path
            go.addItem(i)
        }
        submenu(main, go)

        submenu(main, engineMenu)

        let window = NSMenu(title: "Window")
        window.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), key: "m"))
        window.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        window.addItem(item("Close Window", #selector(NSWindow.performClose(_:)), key: "w"))
        window.addItem(.separator())
        window.addItem(item(name, #selector(AppController.showWindow(_:)), target: target))
        window.addItem(.separator())
        window.addItem(item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))))
        submenu(main, window)
        NSApp.windowsMenu = window

        let help = NSMenu(title: "Help")
        help.addItem(item("Health", #selector(AppController.openHealth(_:)), target: target))
        submenu(main, help)
        NSApp.helpMenu = help

        return main
    }
}
