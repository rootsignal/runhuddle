import Foundation

public struct TerminalTarget: Identifiable, Hashable {
    public let app: String
    public let window: String
    public let identity: String
    public let title: String
    public let cwd: String
    public let tty: String
    public let applicationPID: Int32?
    public let tmux: TmuxRoute?
    public var sessionTTY: String { tmux?.paneTTY ?? tty }
    public var displayTitle: String { tmux.map { "tmux " + $0.pane + " · " + $0.title } ?? title }
    public var id: String { app + ":" + window + ":" + identity + (tmux.map { ":" + $0.serverPID + ":" + $0.session + ":" + $0.pane } ?? "") }
    public init(app: String, window: String, identity: String, title: String, cwd: String = "", tty: String = "", applicationPID: Int32? = nil, tmux: TmuxRoute? = nil) {
        self.app = app; self.window = window; self.identity = identity; self.title = title; self.cwd = cwd
        self.tty = app == "Terminal" ? identity : tty; self.applicationPID = applicationPID; self.tmux = tmux
    }
    public static func cleanTitle(_ title: String) -> String {
        var value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = value.unicodeScalars.first, (0x2800...0x28FF).contains(first.value) {
            value = String(value.unicodeScalars.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        return value
    }
    public func matches(_ row: Session) -> Bool {
        let title = Self.cleanTitle(tmux?.title ?? title)
        let cwd = tmux?.cwd ?? cwd
        let folder = URL(fileURLWithPath: row.cwd).lastPathComponent
        guard !row.title.isEmpty, !folder.isEmpty else { return false }
        if !cwd.isEmpty && URL(fileURLWithPath: cwd).standardized.path != URL(fileURLWithPath: row.cwd).standardized.path { return false }
        let candidate = Self.matchingTitle(title, provider: row.provider,
            live: [.working, .idle, .needsInput].contains(row.state))
        return candidate == row.title + " | " + folder || (!cwd.isEmpty && candidate == row.title)
    }
    // Status decorations are presentation, not session identity. Do not depend on
    // the status snapshot: the terminal and provider can update at different times.
    public static func matchingTitle(_ title: String, provider: String, live: Bool = true) -> String {
        let value = cleanTitle(title)
        guard provider == "Codex", live else { return value }
        return value.replacingOccurrences(of: #"^\[\s*[.!]\s*\]\s+Action Required\s*\|\s*"#,
                                         with: "", options: .regularExpression)
    }

    public func matchRank(for row: Session) -> Int {
        if let tty = row.terminalTTY, !tty.isEmpty,
           [.working, .idle, .needsInput].contains(row.state), sessionTTY == tty { return 0 }
        return matches(row) ? 1 : 2
    }
    public func matchLabel(for row: Session) -> String {
        switch matchRank(for: row) {
        case 0: return "Matches the session’s terminal"
        case 1: return "Matching title · verify before opening"
        default: return "Other terminal"
        }
    }
    public func stillMatchesChoice(_ previous: TerminalTarget, provider: String = "") -> Bool {
        id == previous.id && applicationPID != nil && applicationPID == previous.applicationPID &&
        tty == previous.tty && tmux == previous.tmux && Self.matchingTitle(title, provider: provider) == Self.matchingTitle(previous.title, provider: provider) && cwd == previous.cwd
    }
    public static func ordered(_ targets: [TerminalTarget], for row: Session) -> [TerminalTarget] {
        targets.sorted {
            let left = $0.matchRank(for: row), right = $1.matchRank(for: row)
            return left == right ? $0.id < $1.id : left < right
        }
    }
    public static func uniqueMatch(for row: Session, sessions: [Session], targets: [TerminalTarget]) -> TerminalTarget? {
        guard [.working, .idle, .needsInput].contains(row.state) else { return nil }
        if let tty = row.terminalTTY, !tty.isEmpty {
            let matches = targets.filter { $0.sessionTTY == tty }
            if matches.count == 1 { return matches[0] }
        }
        // Identical session titles in the same project cannot be disambiguated from terminal titles.
        let peers = sessions.filter { !$0.simulated && [.working, .idle, .needsInput].contains($0.state) && $0.title == row.title && URL(fileURLWithPath: $0.cwd).lastPathComponent == URL(fileURLWithPath: row.cwd).lastPathComponent }
        guard peers.count == 1 else { return nil }
        let matches = targets.filter { $0.matches(row) }
        return matches.count == 1 ? matches[0] : nil
    }
}
