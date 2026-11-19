import Foundation

// The engine script's environment, built from nothing (S5, 4.4). The app's own environment is never read
// or passed on: the three values come in as arguments (the app gives this user's home folder and name from the
// user database and the temp folder from the system, see `forThisUser`), and the seven keys below are all the
// child ever sees.
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
    // Not NSHomeDirectory() (it honours CFFIXED_USER_HOME) nor NSTemporaryDirectory() (it honours TMPDIR):
    // whatever set the app's launch environment would choose the engine's state folder (M15, M2).
    public static func forThisUser() -> [String: String] {
        let me = thisUser()
        return build(home: me.home, user: me.name, tmp: systemTemp())
    }

    /// This user's home folder and name, from the user database by user ID.
    public static func thisUser() -> (home: String, name: String) {
        guard let pw = getpwuid(getuid()) else { return ("/var/empty", "nobody") }
        return (String(cString: pw.pointee.pw_dir), String(cString: pw.pointee.pw_name))
    }

    /// This user's temp folder as the system names it (/var/folders/.../T/), whatever TMPDIR says.
    public static func systemTemp() -> String {
        var buf = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buf, buf.count) > 0 else { return "/private/var/empty/" }
        return String(cString: buf)
    }
}
