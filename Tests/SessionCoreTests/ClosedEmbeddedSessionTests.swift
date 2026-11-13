import XCTest
@testable import SessionCore

final class ClosedEmbeddedSessionTests: XCTestCase {
    func testExitReceiptSurvivesRestartAndOverridesLaggingIdle() throws {
        let receipt = ClosedEmbeddedSession(updated: 100, closedAt: 110)
        let restored = try JSONDecoder().decode(ClosedEmbeddedSession.self, from: JSONEncoder().encode(receipt))
        let row = Session(provider: "Codex", sessionID: "one", title: "Work", cwd: "/project", state: .idle, updated: 100)
        XCTAssertEqual(restored.applying(to: row, now: 115).state, .saved)
        XCTAssertEqual(restored.applying(to: row, now: 231).state, .idle)
    }
    func testNewActivityAndOtherStatesAreNeverOverridden() {
        let receipt = ClosedEmbeddedSession(updated: 100, closedAt: 110)
        var row = Session(provider: "Codex", sessionID: "one", title: "Work", cwd: "/project", state: .idle, updated: 111)
        XCTAssertEqual(receipt.applying(to: row, now: 115).state, .idle)
        row.updated = 100
        for state in [SessionState.working, .needsInput, .saved, .archived, .disconnected] {
            row.state = state
            XCTAssertEqual(receipt.applying(to: row, now: 115).state, state)
        }
    }
}
