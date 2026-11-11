import Foundation

/// An independent snapshot, deliberately not keyed by a live session record.
public struct SavedWork: Codable, Identifiable, Equatable, Sendable {
    public var id: UUID = UUID()
    public var title: String
    public var text: String
    public let kind: String
    public let sourceProvider: String
    public let sourceSessionID: String
    public let project: String
    public let sourceUpdated: Double
    public var generatedBy: String?
    public var generatedAt: Date?
    public let createdAt: Date
    public var updatedAt: Date
    public init(session: Session, title: String, text: String = "", kind: String = "Work summary", sourceUpdated: Double? = nil, now: Date = Date()) {
        self.title = title; self.text = text; self.kind = kind
        sourceProvider = session.provider; sourceSessionID = session.sessionID
        project = session.cwd; self.sourceUpdated = sourceUpdated ?? session.updated
        createdAt = now; updatedAt = now
    }
    public var sourceID: String { sourceProvider + ":" + sourceSessionID }
    public func matches(_ query: String) -> Bool {
        let words = query.split(whereSeparator: \.isWhitespace)
        let fields = [title, text, project, sourceProvider, sourceSessionID, kind,
                      createdAt.formatted(date: .numeric, time: .omitted), createdAt.ISO8601Format()].joined(separator: "\n")
        return words.allSatisfy { fields.localizedCaseInsensitiveContains(String($0)) }
    }
    public var markdown: String {
        """
        # \(title)

        Kind: \(kind)
        Project: \(project)
        Source: \(sourceProvider) / \(sourceSessionID)
        Saved: \(createdAt.ISO8601Format())
        Edited: \(updatedAt.ISO8601Format())
        Source activity snapshot: \(Date(timeIntervalSince1970: sourceUpdated).ISO8601Format())
        \(generatedBy.map { "Generated with: " + $0 } ?? "User-written record")
        \(generatedAt.map { "Generated: " + $0.ISO8601Format() } ?? "")

        Independent saved record. AI claims require review; source history may be partial.

        ---

        \(text)
        """
    }
}
