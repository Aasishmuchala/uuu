import AppKit
import EngineShell

// The one home address and the one engine switch, made here and handed to every controller (PLAN-MAC-2
// M5). No controller holds a port, a host or the engine's path.
MainActor.assumeIsolated {
    let home = HomeOrigin.local(port: BuildConstants.homePort)
    let engineSwitch: EngineSwitch = LocalEngineSwitch(flavor: BuildConstants.flavor, compiledRoot: BuildConstants.engineRoot)
    let isRelease = BuildConstants.flavor == "release"
    // D10: a release build whose engine is in place says when the repository holds a newer version of the app.
    let stale = isRelease && engineSwitch.state == .ready
        && VersionFile.isStale(compiled: BuildConstants.version, root: BuildConstants.engineRoot)

    let app = NSApplication.shared
    let controller = AppController(home: home, engine: engineSwitch, stale: stale, isRelease: isRelease)
    app.delegate = controller
    app.setActivationPolicy(.regular)
    // app.delegate is weak: the controller lives as long as the run loop below, which never returns.
    withExtendedLifetime(controller) { app.run() }
}
