import Foundation

// Badge, Notifier and KeepAwake are in their own files (M3).

/// 4.6: the name a download is saved under, before the owner's save panel sees it. The name comes from the
/// server or a page, so it is treated as agent-written: only its last part is kept, hidden characters and
/// leading dots go, it is cut to 120 characters keeping its extension, and a name the Mac would run when
/// opened gets `.txt` added.
public enum SafeName {
    public static let fallback = "download"
    public static let maxLength = 120
    /// Extensions that open as a program, an installer, a script or a link. Compared without case.
    public static let runnable: Set<String> = [
        "app", "command", "terminal", "pkg", "dmg", "workflow", "scpt", "sh", "webloc",
        "mpkg", "scptd", "tool", "inetloc", "fileloc", "prefpane",
        // M15, L4: Java, profiles, internet shortcuts, Automator, Shortcuts, other shells and scripts, disk images.
        "jar", "mobileconfig", "configprofile", "url", "action", "shortcut", "zsh", "bash", "csh", "ksh", "tcsh",
        "py", "pl", "rb", "applescript", "iso", "sparseimage", "sparsebundle", "cdr", "kext", "plugin", "osax",
        "saver", "qlgenerator", "xpc", "bundle",
        // M16b: Terminal settings (they can run a command) and the disk images M16 missed.
        "term", "img", "dmgpart", "toast", "udif", "dvdr", "asif",
    ]

    public static func clean(_ s: String) -> String {
        // Hidden characters first, so none can sit inside a separator or an extension.
        var kept = String.UnicodeScalarView()
        for u in s.unicodeScalars where !TitleText.isHidden(u) { kept.append(u) }
        var name = String(kept)

        // The last part only: "/", "\" and ":" all end a part.
        if let cut = name.lastIndex(where: { $0 == "/" || $0 == "\\" || $0 == ":" }) {
            name = String(name[name.index(after: cut)...])
        }
        name = name.trimmingCharacters(in: .whitespaces)
        while name.hasPrefix(".") { name.removeFirst() }
        while name.hasSuffix(".") || name.hasSuffix(" ") { name.removeLast() }
        if name.isEmpty { return fallback }

        let (base, ext) = split(name)
        let dangerous = ext.map { runnable.contains($0.lowercased()) } ?? false
        let tail = (ext.map { "." + $0 } ?? "") + (dangerous ? ".txt" : "")
        let room = maxLength - (dangerous ? 4 : 0) - (ext.map { $0.count + 1 } ?? 0)
        let cutBase = base.count > room ? String(base.prefix(max(1, room))) : base
        return cutBase + tail
    }

    /// The extension, when the name has one of at most 16 characters after a last dot that is not first.
    static func split(_ name: String) -> (base: String, ext: String?) {
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return (name, nil) }
        let ext = String(name[name.index(after: dot)...])
        guard !ext.isEmpty, ext.count <= 16 else { return (name, nil) }
        return (String(name[..<dot]), ext)
    }
}

/// 4.6 and S6: the window title, from the page's title as plain text: hidden characters removed, cut to
/// 80 characters (and 240 scalars, so stacked marks cannot pile up) with "…"; nothing left is the app's own name.
public enum TitleText {
    public static let maxLength = 80
    /// Unicode scalars kept at most, so 80 characters cannot hide a pile of stacked marks.
    public static let maxScalars = 240

    public static func clean(_ s: String) -> String {
        var kept = String.UnicodeScalarView()
        for u in s.unicodeScalars where !isHidden(u) { kept.append(u) }
        let text = String(kept).trimmingCharacters(in: .whitespaces)
        if text.isEmpty { return NativeWords.appName }
        guard text.count > maxLength || text.unicodeScalars.count > maxScalars else { return text }
        // Whole characters only, at most 79 of them and at most maxScalars - 1 scalars, then "…".
        var out = "", scalars = 0, characters = 0
        for c in text {
            let n = c.unicodeScalars.count
            if characters + 1 > maxLength - 1 || scalars + n > maxScalars - 1 { break }
            out.append(c); scalars += n; characters += 1
        }
        return out + "…"
    }

    /// Control characters, the marks and overrides that change the direction of text, and characters that
    /// show nothing (M15, L4): line and paragraph separators, zero-width spaces and joiners' kin, the byte
    /// order mark, the soft hyphen, the Mongolian vowel separator, invisible operators and tag characters.
    static func isHidden(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x00...0x1F, 0x7F...0x9F: return true
        case 0x200E, 0x200F, 0x202A...0x202E, 0x2066...0x2069: return true
        case 0x00AD, 0x061C, 0x180E, 0x200B, 0x2028, 0x2029, 0x2060...0x2064, 0xFEFF, 0xFFF9...0xFFFB: return true
        case 0xE0000...0xE007F: return true
        default: return false
        }
    }
}
