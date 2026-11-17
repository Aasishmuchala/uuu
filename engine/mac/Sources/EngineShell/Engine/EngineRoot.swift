import Foundation

public enum RootFault: Error { case notFound, notSafe }

public enum EngineRoot {
    public static func check(path: String) -> Result<URL, RootFault> {
        fatalError("M3")
    }
}
