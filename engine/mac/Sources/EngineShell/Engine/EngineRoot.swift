import Foundation

public enum RootFault: Error { case notFound, notSafe }

// D8: the checkout the app was built for. A good root is an absolute path to a real folder of this user's,
// not writable by group or others, not under a temp folder and not inside any hidden folder (so never under
// the engine's own state folder in the home directory), in a folder of this user's (or root's) that others
// cannot change, holding engine and engine/bin as real folders and engine/bin/engine as a regular file, all
// of this user's, none a link, none that others can change. Anything else: Start and Stop are disabled (W10).
public enum EngineRoot {
    public static func check(path: String) -> Result<URL, RootFault> {
        check(path: path, allowTemp: false)
    }

    // `allowTemp` is for the checks, which build their roots in a temp folder. The app never passes it.
    public static func check(path: String, allowTemp: Bool) -> Result<URL, RootFault> {
        guard !path.isEmpty else { return .failure(.notFound) }
        guard path.hasPrefix("/"), !path.contains("\0") else { return .failure(.notSafe) }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true)
        if parts.contains(where: { $0 == "." || $0 == ".." || $0.hasPrefix(".") }) { return .failure(.notSafe) }

        var st = stat()
        guard lstat(path, &st) == 0 else { return .failure(.notFound) }
        guard (st.st_mode & S_IFMT) == S_IFDIR else { return .failure(.notSafe) }   // a link or a file
        guard st.st_uid == getuid(), (st.st_mode & 0o022) == 0 else { return .failure(.notSafe) }

        guard let real = realPath(path) else { return .failure(.notFound) }
        let realParts = real.split(separator: "/", omittingEmptySubsequences: true)
        if realParts.contains(where: { $0.hasPrefix(".") }) { return .failure(.notSafe) }
        if !allowTemp && isUnderTemp(real) { return .failure(.notSafe) }

        // The folder the root sits in: no one else may rename the root away and put another in its place.
        let parent = (real as NSString).deletingLastPathComponent
        var pst = stat()
        guard lstat(parent, &pst) == 0, (pst.st_mode & S_IFMT) == S_IFDIR,
              pst.st_uid == getuid() || pst.st_uid == 0, (pst.st_mode & 0o022) == 0 else { return .failure(.notSafe) }

        // What lies between: engine and engine/bin are real folders of this user's that no one else can change.
        for folder in [real + "/engine", real + "/engine/bin"] {
            var fst = stat()
            guard lstat(folder, &fst) == 0 else { return .failure(.notFound) }
            guard (fst.st_mode & S_IFMT) == S_IFDIR else { return .failure(.notSafe) }   // a link or a file
            guard fst.st_uid == getuid(), (fst.st_mode & 0o022) == 0 else { return .failure(.notSafe) }
        }

        let script = real + "/engine/bin/engine"
        var sst = stat()
        guard lstat(script, &sst) == 0 else { return .failure(.notFound) }
        guard (sst.st_mode & S_IFMT) == S_IFREG else { return .failure(.notSafe) }  // a link or a folder
        guard sst.st_uid == getuid(), (sst.st_mode & 0o022) == 0 else { return .failure(.notSafe) }
        // And the script that runs is the one inside this root, with no link anywhere on the way (M15, L2).
        guard realPath(script) == script else { return .failure(.notSafe) }

        return .success(URL(fileURLWithPath: real, isDirectory: true))
    }

    // The engine script inside a checked root.
    public static func script(in root: URL) -> URL {
        root.appendingPathComponent("engine/bin/engine", isDirectory: false)
    }

    static func realPath(_ path: String) -> String? {
        guard let r = realpath(path, nil) else { return nil }
        defer { free(r) }
        return String(cString: r)
    }

    public static func isUnderTemp(_ real: String) -> Bool {
        var temps = ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp", "/var/folders", "/private/var/folders"]
        let own = EngineEnvironment.systemTemp()   // the system's, not TMPDIR's: TMPDIR must not widen this
        temps.append(own)
        if let r = realPath(own) { temps.append(r) }
        for t in temps {
            let base = t.hasSuffix("/") ? String(t.dropLast()) : t
            if base.isEmpty { continue }
            if real == base || real.hasPrefix(base + "/") { return true }
        }
        return false
    }
}
