import Foundation

public enum Badge {
    public static func text(_ n: Int?) -> String? { fatalError("M5") }
}

public enum Notifier {
    public static func words(previous: Int?, now: Int) -> String? { fatalError("M5") }
}

public enum KeepAwake {
    public static func hold(engineOn: Bool, running: Int, switchOn: Bool, onMains: Bool, battery: Int) -> Bool {
        fatalError("M3")
    }
}

public enum SafeName {
    public static func clean(_ s: String) -> String { fatalError("M5") }
}

public enum TitleText {
    public static func clean(_ s: String) -> String { fatalError("M5") }
}
