import Foundation

public struct ContextUsage: Codable, Hashable, Sendable {
    public let used: Int
    public let limit: Int
    public let reportedAt: String
    public let source: String
    public var fraction: Double? {
        guard used >= 0, limit > 0 else { return nil }
        return Double(used) / Double(limit)
    }
    public init(used: Int, limit: Int, reportedAt: String = "", source: String = "") {
        self.used = used; self.limit = limit; self.reportedAt = reportedAt; self.source = source
    }
}
