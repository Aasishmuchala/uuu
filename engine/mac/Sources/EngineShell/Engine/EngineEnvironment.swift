import Foundation

// The engine script's environment, built from nothing (S5, 4.4). The app's own environment is never read
// or passed on: the three values come in as arguments (the app gives NSHomeDirectory(), NSUserName() and
// NSTemporaryDirectory()), and the seven keys below are all the child ever sees.
public enum EngineEnvironment {
    public static let path = "/usr/bin:/bin:/usr/sbin:/sbin"

    public static func build(home: String, user: String, tmp: String) -> [String: String] {
        [
            "PATH": path,
            "HOME": home,
            "USER": user,
            "LOGNAME": user,
            "TMPDIR": tmp,
            "LANG": "en_US.UTF-8",
            "SHELL": "/bin/bash",
        ]
    }

    // What the app passes: the user's own home, name and temp folder, from the system, not the environment.
    public static func forThisUser() -> [String: String] {
        build(home: NSHomeDirectory(), user: NSUserName(), tmp: NSTemporaryDirectory())
    }
}
