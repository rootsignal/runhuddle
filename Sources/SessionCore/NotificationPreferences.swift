import Foundation

public struct NotificationPreferences: Codable, Equatable {
    public var input = true
    public var completion = true
    public var sound = true
    public var quietHours = false
    public var quietStart = 22
    public var quietEnd = 8
    public var snoozedUntil: Double = 0
    public var reminderMinutes = 0
    public var mutedProjects = Set<String>()
    public init() {}
    public func allows(_ row: Session, kind: SessionAlert.Kind, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard !row.simulated, !mutedProjects.contains(row.cwd), now.timeIntervalSince1970 >= snoozedUntil,
              kind == .input ? input : completion else { return false }
        if quietHours {
            let hour = calendar.component(.hour, from: now)
            if quietStart == quietEnd { return false }
            if quietStart < quietEnd ? (hour >= quietStart && hour < quietEnd) : (hour >= quietStart || hour < quietEnd) { return false }
        }
        return true
    }
}
