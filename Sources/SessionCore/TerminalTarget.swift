import Foundation

public struct TerminalTarget: Identifiable, Hashable {
    public let app: String
    public let window: String
    public let identity: String
    public let title: String
    public let cwd: String
    public var id: String { app + ":" + window + ":" + identity }
    public init(app: String, window: String, identity: String, title: String, cwd: String = "") {
        self.app = app; self.window = window; self.identity = identity; self.title = title; self.cwd = cwd
    }
    public static func cleanTitle(_ title: String) -> String {
        var value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = value.unicodeScalars.first, (0x2800...0x28FF).contains(first.value) {
            value = String(value.unicodeScalars.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        return value
    }
    public func matches(_ row: Session) -> Bool {
        let title = Self.cleanTitle(title)
        let folder = URL(fileURLWithPath: row.cwd).lastPathComponent
        guard !row.title.isEmpty, !folder.isEmpty else { return false }
        if !cwd.isEmpty && URL(fileURLWithPath: cwd).standardized.path != URL(fileURLWithPath: row.cwd).standardized.path { return false }
        return title == row.title + " | " + folder || (!cwd.isEmpty && title == row.title)
    }
    public static func uniqueMatch(for row: Session, sessions: [Session], targets: [TerminalTarget]) -> TerminalTarget? {
        if let tty = row.terminalTTY, !tty.isEmpty, row.state != .saved, row.state != .disconnected {
            let matches = targets.filter { $0.app == "Terminal" && $0.identity == tty }
            if matches.count == 1 { return matches[0] }
        }
        // Identical session titles in the same project cannot be disambiguated from terminal titles.
        let peers = sessions.filter { !$0.simulated && $0.title == row.title && URL(fileURLWithPath: $0.cwd).lastPathComponent == URL(fileURLWithPath: row.cwd).lastPathComponent }
        guard peers.count == 1 else { return nil }
        let matches = targets.filter { $0.matches(row) }
        return matches.count == 1 ? matches[0] : nil
    }
}
