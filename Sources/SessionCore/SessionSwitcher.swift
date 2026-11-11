import Foundation

public enum SessionSwitcher {
    public static func rows(_ sessions: [Session], query: String, names: [String: String]) -> [Session] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return sessions.filter {
            !$0.simulated && [.needsInput, .working, .idle].contains($0.state) &&
            ($0.matches(query) || (names[$0.id] ?? "").localizedCaseInsensitiveContains(query))
        }.sorted {
            if $0.state.rank != $1.state.rank { return $0.state.rank < $1.state.rank }
            if $0.state == .needsInput {
                let left = $0.attention?.since ?? $0.updated, right = $1.attention?.since ?? $1.updated
                if left != right { return left < right }
            }
            if $0.updated != $1.updated { return $0.updated > $1.updated }
            return $0.id < $1.id
        }
    }
    public static func movedSelection(_ selected: String?, by offset: Int, rows: [Session]) -> String? {
        guard !rows.isEmpty else { return nil }
        let current = rows.firstIndex { $0.id == selected } ?? (offset > 0 ? -1 : rows.count)
        return rows[min(max(current + offset, 0), rows.count - 1)].id
    }
}
