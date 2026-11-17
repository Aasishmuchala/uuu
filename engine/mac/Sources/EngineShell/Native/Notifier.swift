// 4.6 and D5: a notification says only how many new items need the owner, from a rise in counts.needsYou
// between two readings. The first reading after the app opens (no previous one) never notifies.
public enum Notifier {
    public static func words(previous: Int?, now: Int) -> String? {
        guard let previous = previous, now > previous else { return nil }
        let rise = now - previous
        return rise == 1 ? "1 new item needs you" : "\(rise) new items need you"
    }
}
