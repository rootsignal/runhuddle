import Foundation

/// A short-lived receipt for a process RunHuddle actually observed exiting.
/// It bridges provider shutdown lag, not permanent ownership or liveness.
public struct ClosedEmbeddedSession: Codable, Equatable {
    public let updated: Double
    public let closedAt: Double
    public init(updated: Double, closedAt: Double) {
        self.updated = updated; self.closedAt = closedAt
    }
    public func suppressesIdle(_ row: Session, now: Double) -> Bool {
        !row.simulated && row.state == .idle && row.updated <= updated
            && now >= closedAt && now - closedAt < 120
    }
    public func applying(to row: Session, now: Double) -> Session {
        guard suppressesIdle(row, now: now) else { return row }
        var result = row
        result.state = .saved
        result.attention = nil
        result.reason = "Embedded process ended; resume in RunHuddle when ready."
        return result
    }
}
