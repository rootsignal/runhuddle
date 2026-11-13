import Foundation

public struct ProjectPreferences: Codable, Equatable, Sendable {
    public var agent = ""
    public var editorPath = ""
    public var localURL = ""
    public var stagingURL = ""
    public var repositoryURL = ""
    public var runCommand = ""
    public var testCommand = ""
    public var buildCommand = ""
    public var note = ""
    public init() {}
    public static func key(_ directory: String) -> String { URL(fileURLWithPath: (directory as NSString).expandingTildeInPath).standardizedFileURL.resolvingSymlinksInPath().path }
    public static func link(_ text: String) -> URL? {
        guard let url = URL(string: text), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
        return url
    }
}
