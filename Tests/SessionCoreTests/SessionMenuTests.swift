import XCTest
@testable import SessionCore

final class SessionMenuTests: XCTestCase {
    func row(_ id: String, _ state: SessionState, updated: Double = 1, simulated: Bool = false) -> Session {
        Session(provider: "Codex", sessionID: id, title: id, cwd: "/tmp", state: state, updated: updated, simulated: simulated)
    }
    func testSummaryExcludesSavedArchivedDisconnectedAndDemos() {
        let menu = SessionMenu(sessions: [row("a", .working), row("b", .needsInput), row("c", .idle),
            row("d", .saved), row("e", .archived), row("f", .disconnected), row("demo", .working, simulated: true)], alerts: [])
        XCTAssertEqual(menu.summary, "1 working · 1 need input · 1 idle")
        XCTAssertTrue(menu.recentlyFinished.isEmpty)
    }
    func testFinishedItemsUseCurrentStateAndDoNotMislabelOldIdleSessions() {
        let old = [row("a", .working), row("b", .working), row("c", .working)]
        let alerts = SessionAlert.transitions(from: old, to: [row("a", .idle), row("b", .idle), row("c", .idle)])
        let menu = SessionMenu(sessions: [row("a", .idle, updated: 8), row("b", .working), row("c", .saved), row("d", .idle)], alerts: alerts)
        XCTAssertEqual(menu.recentlyFinished.map(\.sessionID), ["a"])
        XCTAssertEqual(menu.recentlyFinished.first?.updated, 8)
        XCTAssertEqual(menu.idle.count, 2)
    }
    func testActivitySortedNewestFirstAndFinishedListBounded() {
        let rows = (1...6).map { row("\($0)", .idle, updated: Double($0)) }
        let old = (1...6).map { row("\($0)", .working) }
        let menu = SessionMenu(sessions: rows, alerts: SessionAlert.transitions(from: old, to: rows))
        XCTAssertEqual(menu.idle.first?.sessionID, "6")
        XCTAssertEqual(menu.recentlyFinished.count, 3)
    }
}
