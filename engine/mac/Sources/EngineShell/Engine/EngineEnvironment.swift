import Foundation

// The engine script's environment, built from nothing (S5, 4.4). The app's own environment is never read
// or passed on: the three values come in as arguments (the app gives NSHomeDirectory(), NSUserName() and
// NSTemporaryDirectory()), and the seven keys below are all the child ever sees.
public enum EngineEnvironment {
    // PLAN-MAC-2 N2: fixed, built from nothing. /usr/local/bin (root's) first, as in the owner's terminal;
    // Homebrew (a folder this user can write) last, so it never stands in front of a system tool. Nothing
    // under the home folder (the real, unfenced `claude` lives in ~/.local/bin).
    public static let path = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"

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
