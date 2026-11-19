import AppKit
import EngineShell
import ServiceManagement

// The app: one window (D3), the menus (section 3), the menu bar item, the Dock badge, notifications (D5),
// keep-awake (D6) and the engine's switch (D7). Everything the engine is asked goes through `engine`;
// everything the home screen is asked goes through `home`.
@MainActor
final class AppController: NSObject, NSApplicationDelegate, NSMenuDelegate, NSMenuItemValidation {
    let home: HomeOrigin
    let engine: EngineSwitch
    let stale: Bool
    let isRelease: Bool

    private var windowController: MainWindowController?
    private let poller: Poller
    private var pollEvery: TimeInterval = 0
    private(set) var lastState: Poller.State?
    private var lastNeedsYou: Int?

    private let keepAwake = KeepAwake()
    private var awakeRule = AwakeRule()
    private let notifications = Notifications()
    private var statusItem: StatusItemController?
    private var statusPanel: EngineStatusPanel?

    /// One engine verb at a time from this app; Start, Stop and "Engine status" are off while one runs.
    private(set) var busy = false
    private(set) var starting = false
    /// The last lines the engine printed, shown on the off page.
    private(set) var lastLines: [String] = []

    private let engineMenu = NSMenu(title: "Engine")

    private enum Key {
        static let keepAwake = "keepAwakeWhileAgentsWork"
        static let notify = "notifyWhenSomethingNeedsMe"
    }

    init(home: HomeOrigin, engine: EngineSwitch, stale: Bool, isRelease: Bool) {
        self.home = home
        self.engine = engine
        self.stale = stale
        self.isRelease = isRelease
        self.poller = Poller(home: home)
        UserDefaults.standard.register(defaults: [Key.keepAwake: true, Key.notify: true])
        super.init()
    }

    // MARK: switches (W15)

    var keepAwakeOn: Bool {
        get { UserDefaults.standard.bool(forKey: Key.keepAwake) }
        set { UserDefaults.standard.set(newValue, forKey: Key.keepAwake) }
    }

    var notifyOn: Bool {
        get { UserDefaults.standard.bool(forKey: Key.notify) }
        set { UserDefaults.standard.set(newValue, forKey: Key.notify) }
    }

    var notificationsRefused: Bool { notifications.refused }

    /// Open at login: the system's own record, default off; a development build never offers it.
    var openAtLoginOn: Bool { isRelease && SMAppService.mainApp.status == .enabled }

    var engineReady: Bool { engine.state == .ready }
    var engineActionsEnabled: Bool { engineReady && !busy }

    // MARK: life

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = MainMenu.make(target: self, engineMenu: engineMenu)
        engineMenu.delegate = self
        statusItem = StatusItemController(app: self)
        notifications.onOpen = { [weak self] in self?.go(GoRoute.needsYou) }
        notifications.start()
        showWindow()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if windowController == nil { showWindow() } else { windowController?.window.makeKeyAndOrderFront(nil) }
        return true
    }

    /// Quitting never stops the engine (D7); it lets go of the keep-awake assertion.
    func applicationWillTerminate(_ notification: Notification) {
        poller.stop()
        keepAwake.release()
    }

    // MARK: the window (D3)

    @objc func showWindow(_ sender: Any? = nil) {
        if let wc = windowController {
            wc.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let wc = MainWindowController(home: home, app: self)
        wc.onClose = { [weak self] in
            self?.windowController = nil
            self?.restartPoll()
        }
        windowController = wc
        wc.window.makeKeyAndOrderFront(nil)
        wc.start()
        restartPoll()
    }

    /// Loads a page of the home screen, opening the window first if it is closed.
    func go(_ path: String) {
        showWindow()
        NSApp.activate(ignoringOtherApps: true)
        windowController?.go(path)
    }

    // MARK: the poll (D4)

    private func restartPoll() {
        let every = Poller.interval(windowOpen: windowController != nil)
        guard every != pollEvery else { return }
        pollEvery = every
        poller.start(every: every) { [weak self] state in self?.took(state) }
    }

    private func pollNow() {
        poller.pollOnce { [weak self] state in self?.took(state) }
    }

    private func took(_ state: Poller.State) {
        lastState = state
        NSApp.dockTile.badgeLabel = Badge.text(EngineLine.count(state))
        statusItem?.update(count: EngineLine.count(state))

        let power = KeepAwake.power()
        keepAwake.set(awakeRule.next(state, switchOn: keepAwakeOn, onMains: power.onMains, battery: power.battery,
                                     holding: keepAwake.isHeld))

        if case .up(let s) = state {
            let words = Notifier.words(previous: lastNeedsYou, now: s.needsYou)
            lastNeedsYou = s.needsYou
            if let words, notifyOn { notifications.post(words) }
        }
    }

    // MARK: the engine (D7, W4 to W10)

    @objc func startEngine(_ sender: Any?) {
        guard engineActionsEnabled else { return }
        busy = true
        starting = true
        windowController?.refreshOffPage()
        Task { @MainActor in
            let result = await engine.run(.start)
            busy = false
            starting = false
            lastLines = result.lines
            windowController?.refreshOffPage()
            pollNow()
        }
    }

    @objc func stopEngine(_ sender: Any?) {
        guard engineActionsEnabled else { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = NativeWords.stopTitle
        alert.informativeText = NativeWords.stopBody
        alert.addButton(withTitle: NativeWords.stopConfirm)
        alert.addButton(withTitle: NativeWords.stopCancel)
        let decide: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard response == .alertFirstButtonReturn else { return }
            self?.runStop()
        }
        if let window = windowController?.window, window.isVisible {
            alert.beginSheetModal(for: window, completionHandler: decide)
        } else {
            NSApp.activate(ignoringOtherApps: true)
            decide(alert.runModal())
        }
    }

    private func runStop() {
        guard engineActionsEnabled else { return }
        busy = true
        Task { @MainActor in
            let result = await engine.run(.stop)
            busy = false
            lastLines = result.lines
            windowController?.refreshOffPage()
            pollNow()
        }
    }

    @objc func showEngineStatus(_ sender: Any?) {
        guard engineActionsEnabled else { return }
        busy = true
        let panel = statusPanel ?? EngineStatusPanel()
        statusPanel = panel
        panel.show(lines: [])
        Task { @MainActor in
            let result = await engine.run(.status)
            busy = false
            panel.show(lines: result.lines)
        }
    }

    /// What the off page says now (D11).
    func offPageText(notAnswering: Bool) -> OffPageText {
        OffPageText.make(engine.state, starting: starting, notAnswering: notAnswering)
    }

    // MARK: switches

    @objc func toggleKeepAwake(_ sender: Any?) {
        keepAwakeOn.toggle()
        if !keepAwakeOn { keepAwake.release() }
    }

    @objc func toggleNotify(_ sender: Any?) {
        guard !notifications.refused else { return }
        notifyOn.toggle()
    }

    @objc func toggleOpenAtLogin(_ sender: Any?) {
        guard isRelease else { return }
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled { try service.unregister() } else { try service.register() }
        } catch {
            // The system says no (for example, the owner turned it off in System Settings): leave it as it is.
        }
    }

    // MARK: menu actions that reach the page

    @objc func goRoute(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        go(path)
    }

    @objc func openSettings(_ sender: Any?) { go(GoRoute.settings) }
    @objc func openHealth(_ sender: Any?) { go(GoRoute.health) }
    @objc func reloadPage(_ sender: Any?) { windowController?.reload() }
    @objc func goBack(_ sender: Any?) { windowController?.web?.goBack() }
    @objc func goForward(_ sender: Any?) { windowController?.web?.goForward() }
    @objc func zoomIn(_ sender: Any?) { windowController?.zoom(by: 0.1) }
    @objc func zoomOut(_ sender: Any?) { windowController?.zoom(by: -0.1) }
    @objc func actualSize(_ sender: Any?) { windowController?.zoomReset() }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(startEngine(_:)), #selector(stopEngine(_:)), #selector(showEngineStatus(_:)):
            return engineActionsEnabled
        case #selector(toggleNotify(_:)):
            return !notifications.refused
        case #selector(reloadPage(_:)), #selector(zoomIn(_:)), #selector(zoomOut(_:)), #selector(actualSize(_:)):
            return windowController?.showingWeb == true
        case #selector(goBack(_:)):
            return windowController?.showingWeb == true && windowController?.web?.canGoBack == true
        case #selector(goForward(_:)):
            return windowController?.showingWeb == true && windowController?.web?.canGoForward == true
        default:
            return true
        }
    }

    // MARK: the Engine menu, rebuilt each time it opens

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu === engineMenu else { return }
        menu.removeAllItems()
        for line in engineLines() {
            let item = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }
        if menu.items.count > 0 { menu.addItem(.separator()) }
        menu.addItem(MainMenu.item(NativeWords.start, #selector(startEngine(_:)), target: self))
        menu.addItem(MainMenu.item(NativeWords.stopMenu, #selector(stopEngine(_:)), target: self))
        menu.addItem(.separator())
        menu.addItem(MainMenu.item(NativeWords.engineStatus, #selector(showEngineStatus(_:)), target: self))
    }

    /// The Engine menu's disabled lines: why the switch cannot be used (W8 or W10) first, then the state
    /// (W13), then W11 when a newer version of the app is in the repository.
    func engineLines() -> [String] {
        var lines: [String] = []
        if case .unavailable(let sentence) = engine.state { lines.append(sentence) }
        if let state = lastState { lines.append(EngineLine.text(state)) }
        if stale { lines.append(NativeWords.stale) }
        return lines
    }
}
