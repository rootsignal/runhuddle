import Foundation

public enum SessionPresentation {
    public static func includes(_ row: Session, filter: String, pinned: Set<String> = [], owned: Bool? = nil) -> Bool {
        switch filter {
        case "Saved": return row.state == .saved
        case "Disconnected": return row.state == .disconnected
        case "Running here": return owned != false && [.needsInput, .working, .idle].contains(row.state)
        case "Running elsewhere": return owned == false && !row.simulated && [.needsInput, .working, .idle].contains(row.state)
        case "Pinned": return pinned.contains(row.id) && row.state != .archived
        case "All sessions": return row.state != .archived
        default: return row.state.title == filter
        }
    }

    public static func excerpt(_ text: String, limit: Int = 180) -> String {
        let plain = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))).map { String($0.characters) } ?? text
        let compact = plain.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard compact.count > limit else { return compact }
        let prefix = String(compact.prefix(limit))
        let end = prefix.lastIndex(of: " ") ?? prefix.endIndex
        return String(prefix[..<end]) + "…"
    }

    public static func statusSummary(_ row: Session) -> String {
        switch row.state {
        case .needsInput: return "Waiting for your input"
        case .working: return "\(row.provider) reports work in progress"
        case .idle: return "Idle · agent is still open"
        case .saved: return "Closed · resume when you’re ready"
        case .archived: return "Archived · history preserved until removal"
        case .disconnected:
            if row.reason.localizedCaseInsensitiveContains("no controlling terminal") {
                return "Terminal detached · current activity is unconfirmed"
            }
            return "Live status could not be confirmed"
        }
    }
}
