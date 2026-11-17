// The native words the engine's switch gives back (4.7). Fixed; never composed from the engine's output.
public enum EngineWords {
    public static let devBuild = "This is a development build. It cannot start or stop the engine."            // W8
    public static let busy = "The engine is already being started or stopped. Wait for it to finish."          // W9
    public static let badRoot = "This app cannot find the engine it was built for. Rebuild it: engine/mac/build.sh --install"  // W10
}
