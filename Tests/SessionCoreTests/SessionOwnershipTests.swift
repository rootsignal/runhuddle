import XCTest
@testable import SessionCore

final class SessionOwnershipTests: XCTestCase {
    func testActiveSessionsAreSplitByOwnership() {
        for state in [SessionState.working, .idle, .needsInput] {
            let row = Session(provider: "Codex", sessionID: "one", title: "Work", cwd: "/project", state: state)
            XCTAssertTrue(SessionPresentation.includes(row, filter: "Running here", owned: true))
            XCTAssertFalse(SessionPresentation.includes(row, filter: "Running here", owned: false))
            XCTAssertTrue(SessionPresentation.includes(row, filter: "Running elsewhere", owned: false))
            XCTAssertFalse(SessionPresentation.includes(row, filter: "Running elsewhere", owned: true))
            XCTAssertTrue(SessionPresentation.includes(row, filter: "All sessions", owned: false))
            XCTAssertTrue(SessionPresentation.includes(row, filter: "Pinned", pinned: [row.id], owned: false))
        }
    }
    func testEmbeddedTitleMatchingExcludesAlreadyOwnedPredecessor() {
        let old = Session(provider: "Codex", sessionID: "old", title: "Same task", cwd: "/project", state: .idle)
        let new = Session(provider: "Codex", sessionID: "new", title: "Same task", cwd: "/project", state: .working)
        let target = TerminalTarget(app: "RunHuddle", window: "new-pane", identity: "new-pane", title: "Same task | project", cwd: "/project")
        XCTAssertNil(target.uniqueUnclaimedSession(in: [old, new], claimedIDs: []))
        XCTAssertEqual(target.uniqueUnclaimedSession(in: [old, new], claimedIDs: [old.id])?.id, new.id)
        XCTAssertNil(target.uniqueUnclaimedSession(in: [old], claimedIDs: [old.id]))
        let duplicate = Session(provider: "Codex", sessionID: "third", title: "Same task", cwd: "/project", state: .idle)
        XCTAssertNil(target.uniqueUnclaimedSession(in: [old, new, duplicate], claimedIDs: [old.id]))
    }

    func testInactiveSessionsAreNotExternal() {
        for state in [SessionState.saved, .archived, .disconnected] {
            let row = Session(provider: "Claude", sessionID: "one", title: "Work", cwd: "/project", state: state)
            XCTAssertFalse(SessionPresentation.includes(row, filter: "Running elsewhere", owned: false))
            XCTAssertFalse(SessionPresentation.includes(row, filter: "Running here", owned: true))
        }
    }
}
