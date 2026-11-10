// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SessionManager", platforms: [.macOS(.v14)],
    products: [.executable(name: "SessionManager", targets: ["SessionManager"])],
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(name: "SessionCore", dependencies: ["CSQLite"]),
        .executableTarget(name: "SessionManager", dependencies: ["SessionCore", .product(name: "Sparkle", package: "Sparkle")],
                          linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]),
        .testTarget(name: "SessionCoreTests", dependencies: ["SessionCore"])
    ], swiftLanguageModes: [.v5]
)
