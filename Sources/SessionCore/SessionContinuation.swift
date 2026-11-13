import Foundation

public struct SessionContinuation: Codable, Equatable, Sendable {
    public let sourceID: String
    public let sourceTitle: String
    public let createdAt: Double
    public let relationship: String?
    public var sourceLabel: String { relationship == "reviewed" ? "Review of" : relationship == "branched" ? "Branched from" : "Continued from" }
    public init(sourceID: String, sourceTitle: String, createdAt: Double = Date().timeIntervalSince1970, relationship: String? = nil) {
        self.sourceID = sourceID; self.sourceTitle = sourceTitle; self.createdAt = createdAt; self.relationship = relationship
    }
    /// Accept only the explicit header emitted by RunHuddle, never title similarity.
    public static func fromHandoff(_ text: String) -> SessionContinuation? {
        guard text.hasPrefix("Continue from this handoff. First inspect the current project state.\n\n# Handoff: ") else { return nil }
        let lines = text.components(separatedBy: "\n")
        guard lines.count > 4, lines[4].hasPrefix("Source: ") else { return nil }
        let source = String(lines[4].dropFirst(8)).components(separatedBy: " / ")
        guard source.count == 2, ["Codex", "Claude", "Copilot"].contains(source[0]), UUID(uuidString: source[1]) != nil else { return nil }
        return .init(sourceID: source[0] + ":" + source[1], sourceTitle: String(lines[2].dropFirst(11)))
    }
}

public enum SessionChain {
    public static func ancestors(of id: String, links: [String: SessionContinuation]) -> [String] {
        var seen: Set<String> = [id], result: [String] = [], current = id
        while let parent = links[current]?.sourceID, seen.insert(parent).inserted {
            result.append(parent); current = parent
        }
        return result
    }
    public static func canLink(child: String, parent: String, links: [String: SessionContinuation]) -> Bool {
        child != parent && !ancestors(of: parent, links: links).contains(child)
    }
    /// Each idle or closed predecessor appears under one newest visible leaf, including forks.
    /// Working, awaiting-input, pinned and filtered-out sessions are never hidden.
    public static func groups(rows: [Session], links: [String: SessionContinuation], pinned: Set<String>) -> [String: [Session]] {
        let continuationLinks = links.filter { $0.value.relationship == nil || $0.value.relationship == "continued" }
        let ancestors = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, Self.ancestors(of: $0.id, links: continuationLinks)) })
        var result: [String: [Session]] = [:]
        for row in rows where (row.state == .saved || row.state == .idle) && !pinned.contains(row.id) {
            let descendants = rows.filter { ancestors[$0.id, default: []].contains(row.id) }
            let leaves = descendants.filter { candidate in !descendants.contains { ancestors[$0.id, default: []].contains(candidate.id) } }
            let head = leaves.sorted {
                let left = links[$0.id]?.createdAt ?? 0, right = links[$1.id]?.createdAt ?? 0
                return left == right ? $0.id < $1.id : left > right
            }.first
            if let head { result[head.id, default: []].append(row) }
        }
        for head in Array(result.keys) {
            let order = ancestors[head, default: []]
            result[head]?.sort { (order.firstIndex(of: $0.id) ?? 0) < (order.firstIndex(of: $1.id) ?? 0) }
        }
        return result
    }
}
