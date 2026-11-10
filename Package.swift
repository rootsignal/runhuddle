// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SessionManager", platforms: [.macOS(.v14)],
    products: [.executable(name: "SessionManager", targets: ["SessionManager"])],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "SessionCore", dependencies: ["CSQLite"]),
        .executableTarget(name: "SessionManager", dependencies: ["SessionCore"]),
        .testTarget(name: "SessionCoreTests", dependencies: ["SessionCore"])
    ], swiftLanguageModes: [.v5]
)
