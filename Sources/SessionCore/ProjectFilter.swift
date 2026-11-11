import Foundation

/// A display grouping only: original working directories and session history stay intact.
public enum ProjectFilter {
    public static let temporary = "Temporary / other"
    public static func isTemporary(_ path: String) -> Bool {
        guard !path.isEmpty else { return true }
        let normalized = normalize(path)
        let roots = ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp", "/var/folders", "/private/var/folders", NSTemporaryDirectory()]
        return roots.contains { root in
            let base = normalize(root)
            return normalized == base || normalized.hasPrefix(base + "/")
        }
    }
    private static func normalize(_ path: String) -> String {
        var parts: [Substring] = []
        for part in path.split(separator: "/") {
            if part == "." { continue }
            if part == ".." { if !parts.isEmpty { parts.removeLast() } }
            else { parts.append(part) }
        }
        return "/" + parts.joined(separator: "/")
    }
    public static func matches(_ path: String, selection: String) -> Bool {
        selection == "All projects" || (selection == temporary ? isTemporary(path) : path == selection)
    }
    public static func options(_ paths: [String]) -> [String] {
        let regular = Set(paths.filter { !isTemporary($0) }).sorted()
        return regular + (paths.contains(where: isTemporary) ? [temporary] : [])
    }
    public static func title(_ path: String) -> String {
        path == temporary ? temporary : URL(fileURLWithPath: path).lastPathComponent
    }
}
