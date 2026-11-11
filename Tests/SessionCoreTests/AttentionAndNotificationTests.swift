import XCTest
@testable import SessionCore

final class AttentionAndNotificationTests: XCTestCase {
    func row(_ state: SessionState = .needsInput) -> Session { Session(provider: "Codex", sessionID: "one", title: "Task", cwd: "/work/project", state: state) }
    func testWaitAgeSurvivesRefreshButResetsAfterResolution() throws {
        var previous = row(); previous.attention = AttentionRequest(kind: "permission", since: 100)
        var next = row(); next.updated = 500
        XCTAssertEqual(AttentionRequest.reconcile(next, previous: previous, now: 500)?.since, 100)
        XCTAssertEqual(AttentionRequest.reconcile(next, previous: row(.working), now: 500)?.since, 500)
        XCTAssertNil(AttentionRequest.reconcile(row(.idle), previous: previous, now: 500))
        next.attention = AttentionRequest(kind: "question", detail: "Choose a database", since: 300)
        XCTAssertEqual(AttentionRequest.reconcile(next, previous: previous, now: 500)?.since, 300)
        let data = try JSONEncoder().encode(next)
        XCTAssertEqual(try JSONDecoder().decode(Session.self, from: data).attention, next.attention)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]); object.removeValue(forKey: "attention")
        XCTAssertNil(try JSONDecoder().decode(Session.self, from: JSONSerialization.data(withJSONObject: object)).attention)
    }
    func testQuietHoursAcrossMidnightAndDaytime() {
        var p = NotificationPreferences(); p.quietHours = true
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(secondsFromGMT: 0)!
        func date(_ hour: Int) -> Date { cal.date(from: DateComponents(year: 2026, month: 11, day: 10, hour: hour))! }
        for hour in [22, 23, 0, 7] { XCTAssertFalse(p.allows(row(), kind: .input, now: date(hour), calendar: cal)) }
        for hour in [8, 12, 21] { XCTAssertTrue(p.allows(row(), kind: .input, now: date(hour), calendar: cal)) }
        p.quietStart = 9; p.quietEnd = 17
        XCTAssertFalse(p.allows(row(), kind: .input, now: date(9), calendar: cal))
        XCTAssertTrue(p.allows(row(), kind: .input, now: date(17), calendar: cal))
        p.quietStart = 17
        XCTAssertFalse(p.allows(row(), kind: .input, now: date(12), calendar: cal))
    }
    func testPreferencesPersistAndMutedProjectUsesFullPath() throws {
        var p = NotificationPreferences(); p.mutedProjects = ["/work/project"]
        XCTAssertFalse(p.allows(row(), kind: .input))
        var other = row(); other.cwd = "/other/project"
        XCTAssertTrue(p.allows(other, kind: .input))
        p.snoozedUntil = 200
        XCTAssertFalse(p.allows(other, kind: .input, now: Date(timeIntervalSince1970: 100)))
        XCTAssertTrue(p.allows(other, kind: .input, now: Date(timeIntervalSince1970: 200)))
        p.input = false
        XCTAssertFalse(p.allows(other, kind: .input))
        XCTAssertTrue(p.allows(other, kind: .finished))
        XCTAssertEqual(try JSONDecoder().decode(NotificationPreferences.self, from: JSONEncoder().encode(p)), p)
    }
    func testBatchDeduplicatesAndDropsResolvedOrNowMutedRequests() {
        let alert = SessionAlert(session: row(), kind: .input)
        XCTAssertEqual(NotificationBatch.current([alert, alert], sessions: [row()], preferences: .init()).count, 1)
        XCTAssertTrue(NotificationBatch.current([alert], sessions: [row(.working)], preferences: .init()).isEmpty)
        XCTAssertTrue(NotificationBatch.current([alert], sessions: [], preferences: .init()).isEmpty)
        var p = NotificationPreferences(); p.input = false
        XCTAssertTrue(NotificationBatch.current([alert], sessions: [row()], preferences: p).isEmpty)
        let finished = SessionAlert(session: row(.idle), kind: .finished)
        XCTAssertTrue(NotificationBatch.current([finished], sessions: [row(.needsInput)], preferences: .init()).isEmpty)
    }
}
