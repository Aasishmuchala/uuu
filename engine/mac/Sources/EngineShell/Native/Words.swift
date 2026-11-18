// The native words of PLAN-MAC 4.7, as written there. Fixed: never composed from anything the server or a
// page sends. W8, W9 and W10 are EngineWords (the engine's switch gives them back).
public enum NativeWords {
    public static let appName = "Company Engine"                                                    // W1
    public static let offTitle = "The engine is off."                                               // W2
    public static let offLine = "Start it to open the home screen."                                 // W3
    public static let start = "Start the engine"                                                    // W4
    public static let starting = "Starting the engine. This can take a minute or two."              // W5
    public static let stopMenu = "Stop the engine…"                                                 // W6
    public static let stopTitle = "Turn the engine off?"                                            // W7
    public static let stopBody = "Agents that are working will stop. Nothing is lost; start the engine to carry on."
    public static let stopConfirm = "Turn off"
    public static let stopCancel = "Cancel"
    public static let stale = "A newer version of this app is in the repository. Run: engine/mac/build.sh --install"  // W11
    public static let pageMessageHeading = "The home screen says"                                   // W12
    public static let engineOn = "Engine: on"                                                       // W13
    public static let engineOff = "Engine: off"
    public static let engineAttention = "Engine: needs attention"
    public static func needsYou(_ n: Int) -> String { "Needs you: \(n)" }                          // W14
    public static let nothingNeedsYou = "Nothing needs you"
    public static let keepAwake = "Keep the Mac awake while agents work"                            // W15
    public static let keepAwakeNote = "A closed lid still puts the Mac to sleep."
    public static let notifyMe = "Notify me when something needs me"
    public static let openAtLogin = "Open Company Engine at login"
    public static let notAnswering = "The home screen is not answering. Stop the engine, then start it."  // W16
    public static let notificationTitle = "Company Engine"                                          // W17

    // Under the greyed W15 notify switch once notifications were refused: where the system keeps the setting
    // (OLD M5: "the system's own wording for where to allow it"). Not in 4.7; for the orchestrator to approve.
    public static let notificationsWhere = "Allow it in System Settings › Notifications › Company Engine"

    // Menu item names: the section 3 page names and the system's own item names.
    public static let engineStatus = "Engine status"
    public static let openApp = "Open Company Engine"
    public static let quit = "Quit Company Engine"
}
