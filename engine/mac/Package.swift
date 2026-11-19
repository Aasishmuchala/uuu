// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CompanyEngine",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "EngineShell", targets: ["EngineShell"]),
        .executable(name: "CompanyEngine", targets: ["CompanyEngine"]),
        .executable(name: "webkit-probe", targets: ["WebKitProbe"]),
        .executable(name: "engine-mac-checks", targets: ["EngineMacChecks"]),
    ],
    targets: [
        .target(name: "EngineShell", exclude: ["Web/Rules.json"]),
        .executableTarget(name: "CompanyEngine", dependencies: ["EngineShell"]),
        .executableTarget(name: "WebKitProbe", dependencies: ["EngineShell"]),
        .executableTarget(name: "EngineMacChecks", dependencies: ["EngineShell"]),
    ],
    swiftLanguageModes: [.v5]
)
