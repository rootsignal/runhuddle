import Foundation

public struct LocalImageReference: Identifiable, Equatable, Sendable {
    public let source: String
    public let path: String
    public var id: String { path }
    public var filename: String { URL(fileURLWithPath: path).lastPathComponent }
    public static let extensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff", "bmp"]

    public static func extract(from text: String) -> [LocalImageReference] {
        let pattern = #"(?<![\w:/])(?:file://|~/|/)[^\n\r<>\"`]*?\.(?:png|jpe?g|gif|webp|heic|tiff?|bmp)(?=$|[\s\"'`.,;:)\]])"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        var seen = Set<String>()
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            guard let range = Range(match.range, in: text) else { return nil }
            let source = String(text[range])
            let path: String
            if source.hasPrefix("file://") {
                guard let url = URL(string: source), url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost" else { return nil }
                path = url.path
            } else { path = (source as NSString).expandingTildeInPath }
            guard seen.insert(path).inserted else { return nil }
            return LocalImageReference(source: source, path: path)
        }
    }
    public static func displayText(_ text: String, references: [LocalImageReference]) -> String {
        references.reduce(text) { $0.replacingOccurrences(of: $1.source, with: "[Image]") }
    }
    public static func prompt(text: String, paths: [String]) -> String {
        ([text] + paths).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }
}
