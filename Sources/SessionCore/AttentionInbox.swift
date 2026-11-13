import Foundation

public struct InboxEntry: Codable, Identifiable, Equatable, Sendable {
    public let id: String
    public let sessionID: String
    public let title: String
    public let kind: String
    public let date: Date
    public var read: Bool
    public init(session: Session, kind: String, date: Date = Date()) {
        id = session.id + ":" + kind; sessionID = session.id; title = session.title
        self.kind = kind; self.date = date; read = false
    }
}

public enum AttentionInbox {
    public static func updating(_ entries: [InboxEntry], previous: [Session], current: [Session]) -> [InboxEntry] {
        var result = entries
        for alert in SessionAlert.transitions(from: previous, to: current) where alert.kind == .finished {
            let entry = InboxEntry(session: alert.session, kind: "result")
            result.removeAll { $0.id == entry.id }; result.insert(entry, at: 0)
        }
        return Array(result.prefix(100))
    }
    public static func reading(_ entries: [InboxEntry], sessionID: String) -> [InboxEntry] {
        entries.map { item in var item = item; if item.sessionID == sessionID { item.read = true }; return item }
    }
}
