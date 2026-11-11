import Foundation

public enum NotificationBatch {
    public static func current(_ alerts: [SessionAlert], sessions: [Session], preferences: NotificationPreferences, now: Date = Date()) -> [SessionAlert] {
        let latest = Dictionary(alerts.map { ($0.session.id, $0) }, uniquingKeysWith: { _, last in last })
        return latest.values.compactMap { alert in
            guard let row = sessions.first(where: { $0.id == alert.session.id }),
                  row.state == (alert.kind == .input ? .needsInput : .idle),
                  preferences.allows(row, kind: alert.kind, now: now) else { return nil }
            return SessionAlert(session: row, kind: alert.kind)
        }.sorted { $0.session.id < $1.session.id }
    }
}
