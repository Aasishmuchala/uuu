// 4.6: the Dock badge for the Needs-you count. No badge at nothing, or when the home screen is down (nil).
public enum Badge {
    public static func text(_ n: Int?) -> String? {
        guard let n = n, n > 0 else { return nil }
        return n > 99 ? "99+" : String(n)
    }
}
