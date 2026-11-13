import Foundation

public enum SessionResumePolicy {
    /// A live or uncertain conversation needs explicit user confirmation.
    /// Existing RunHuddle terminals are selected before this launch check.
    public static func canLaunch(_ row: Session, externalConfirmed: Bool = false) -> Bool {
        guard !row.simulated else { return false }
        return [.saved, .archived].contains(row.state) || externalConfirmed
    }
}
