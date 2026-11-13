import Foundation

public struct ProjectEditor: Identifiable, Equatable {
    public let name: String
    public let path: String
    public var id: String { path }
    public init?(application: URL) {
        guard application.pathExtension == "app", let bundle = Bundle(url: application),
              bundle.bundleIdentifier != nil,
              let executable = bundle.executableURL,
              FileManager.default.isExecutableFile(atPath: executable.path) else { return nil }
        let filename = application.deletingPathExtension().lastPathComponent
        name = filename == "Visual Studio Code" ? "VS Code" : (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? application.deletingPathExtension().lastPathComponent
        path = application.standardizedFileURL.path
    }
    public static func discover(in roots: [URL]) -> [Self] {
        let names: Set<String> = ["Visual Studio Code", "Visual Studio Code - Insiders", "Cursor", "Windsurf", "Zed", "Sublime Text", "Nova", "BBEdit", "IntelliJ IDEA", "IntelliJ IDEA CE", "WebStorm", "PyCharm", "PyCharm CE", "GoLand", "CLion", "Rider", "RustRover", "Xcode"]
        var found: [String: Self] = [:]
        for root in roots {
            guard let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { continue }
            for case let url as URL in walker {
                if url.pathExtension == "app" {
                    walker.skipDescendants()
                    if names.contains(url.deletingPathExtension().lastPathComponent), let app = Self(application: url) { found[app.id] = app }
                } else if walker.level >= 3 { walker.skipDescendants() }
            }
        }
        return found.values.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    public static func preferred(path: String, installed: [Self]) -> Self? {
        // An explicit choice must not silently fall back if the app is removed.
        if !path.isEmpty { return Self(application: URL(fileURLWithPath: path)) }
        return installed.first { URL(fileURLWithPath: $0.path).lastPathComponent == "Visual Studio Code.app" } ?? installed.first
    }
}
