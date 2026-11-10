import Foundation

public enum SessionPresentation {
    public static func refreshInterval(for sessions: [Session]) -> Double {
        let live = sessions.filter { !$0.simulated }
        if live.contains(where: { [.working, .needsInput].contains($0.state) }) { return 5 }
        if live.contains(where: { $0.state == .idle }) { return 15 }
        return 30
    }

    public static func includes(_ row: Session, filter: String, pinned: Set<String> = []) -> Bool {
        switch filter {
        case "Now": return [.needsInput, .working, .idle].contains(row.state)
        case "Pinned": return pinned.contains(row.id) && row.state != .archived
        case "All sessions": return row.state != .archived
        default: return row.state.title == filter
        }
    }

    public static func excerpt(_ text: String, limit: Int = 180) -> String {
        let compact = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard compact.count > limit else { return compact }
        let prefix = String(compact.prefix(limit))
        let end = prefix.lastIndex(of: " ") ?? prefix.endIndex
        return String(prefix[..<end]) + "…"
    }

    public static func statusSummary(_ row: Session) -> String {
        switch row.state {
        case .needsInput: return "Waiting for your input"
        case .working: return "\(row.provider) reports work in progress"
        case .idle: return "Ready for your next prompt"
        case .saved: return "Saved · resume when you’re ready"
        case .archived: return "Archived · history preserved until removal"
        case .disconnected:
            if row.reason.localizedCaseInsensitiveContains("no controlling terminal") {
                return "Terminal detached · current activity is unconfirmed"
            }
            return "Live status could not be confirmed"
        }
    }
}
