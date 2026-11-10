import Foundation

public enum Recovery {
    public static func offline(_ rows: [Session], reason: String) -> [Session] {
        rows.map { original in
            var row = original
            if !row.simulated && row.state != .saved && row.state != .archived {
                row.state = .disconnected
                row.reason = reason
            }
            return row
        }
    }
    public static func restore(_ rows: [Session]) -> [Session] {
        offline(rows.filter { !$0.simulated }, reason: "Restored from disk; waiting for a live connection")
    }
}
