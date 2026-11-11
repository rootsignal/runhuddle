import XCTest
@testable import SessionCore

final class SessionSwitcherTests: XCTestCase {
    func session(_ id: String, _ state: SessionState, _ provider: String = "Codex") -> Session {
        Session(provider: provider, sessionID: id, title: "Task " + id, cwd: "/work/project", state: state, updated: 100)
    }
    func testOnlyLiveRealSessionsAndPriorityAcrossAgents() {
        let waiting = session("a", .needsInput, "Claude")
        let working = session("b", .working, "Copilot")
        let idle = session("c", .idle)
        var demo = session("demo", .needsInput); demo.simulated = true
        let input = [idle, session("d", .saved), working, session("e", .archived), demo, waiting, session("f", .disconnected)]
        XCTAssertEqual(SessionSwitcher.rows(input, query: "", names: [:]), [waiting, working, idle])
        XCTAssertEqual(SessionSwitcher.rows(input, query: "  COPILOT  ", names: [:]), [working])
        XCTAssertEqual(SessionSwitcher.rows(input, query: "release", names: [idle.id: "Release checklist"]), [idle])
        XCTAssertEqual(SessionSwitcher.rows(input, query: "project", names: [:]).count, 3)
    }
    func testKeyboardSelectionHandlesEmptyRemovedAndBoundaryRows() {
        let rows = [session("a", .working), session("b", .idle)]
        XCTAssertNil(SessionSwitcher.movedSelection(nil, by: 1, rows: []))
        XCTAssertEqual(SessionSwitcher.movedSelection(nil, by: 1, rows: rows), rows[0].id)
        XCTAssertEqual(SessionSwitcher.movedSelection("gone", by: -1, rows: rows), rows[1].id)
        XCTAssertEqual(SessionSwitcher.movedSelection(rows[1].id, by: 1, rows: rows), rows[1].id)
        XCTAssertEqual(SessionSwitcher.movedSelection(rows[0].id, by: -1, rows: rows), rows[0].id)
    }
    func testShortcutValidationAndPersistence() throws {
        XCTAssertTrue(SwitcherShortcut.standard.valid)
        XCTAssertEqual(try JSONDecoder().decode(SwitcherShortcut.self, from: JSONEncoder().encode(SwitcherShortcut.standard)), .standard)
        XCTAssertFalse(SwitcherShortcut(keyCode: 49, modifiers: 0, label: "Space").valid)
        XCTAssertFalse(SwitcherShortcut(keyCode: 49, modifiers: 512, label: "⇧Space").valid)
        XCTAssertFalse(SwitcherShortcut(keyCode: 53, modifiers: 4096, label: "⌃Escape").valid)
        XCTAssertFalse(SwitcherShortcut(keyCode: 49, modifiers: UInt32.max, label: "Bad").valid)
    }
}
