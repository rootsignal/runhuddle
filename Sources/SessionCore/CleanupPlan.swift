import Foundation

public struct CleanupPlan: Decodable, Identifiable {
    public struct Affected: Decodable, Identifiable {
        public let id: String
        public let title: String
    }
    public let action: String
    public let threadID: String
    public let affected: [Affected]
    public var id: String { action + ":" + threadID }
    public var title: String {
        switch action {
        case "delete": "Permanently delete"
        case "restore": "Restore"
        default: "Archive"
        }
    }
    public var explanation: String {
        switch action {
        case "delete": "Permanently deletes the listed conversation histories from Codex, including listed child sessions. This cannot be undone. Their handoff drafts in this tracker will also be removed. Repository files are not targeted. Export any handoff you want to keep first."
        case "restore": "Restores this conversation to Codex's active history. Archived child sessions remain archived and can be restored separately."
        default: "Moves the listed conversation histories into Codex's archive, including listed child sessions. They leave the main list but remain available in Archived. Your handoff drafts stay saved. This affects Codex history, not just this tracker."
        }
    }
}
