import XCTest
@testable import SessionCore

final class WorkspaceActivityTests: XCTestCase {
    private func session(_ id: String, _ state: SessionState, cwd: String = "/tmp/project", simulated: Bool = false) -> Session {
        Session(provider: "Codex", sessionID: id, title: id, cwd: cwd, state: state, simulated: simulated)
    }
    func testOriginalSessionIsNotAnotherAgentEvenWhenWorking() {
        for state in [SessionState.idle, .working, .needsInput] {
            let source = session("source", state)
            let activity = WorkspaceActivity(sessions: [source], directory: source.cwd, excluding: source.id)
            XCTAssertEqual(activity.working + activity.waiting + activity.idle, 0)
        }
    }
    func testIdleAndWaitingAreNotReportedAsWorking() {
        let rows = [session("source", .idle), session("idle", .idle), session("waiting", .needsInput)]
        let activity = WorkspaceActivity(sessions: rows, directory: "/tmp/project", excluding: rows[0].id)
        XCTAssertEqual(activity.working, 0)
        XCTAssertEqual(activity.idle, 1)
        XCTAssertEqual(activity.waiting, 1)
    }
    func testOnlyOtherWorkingSessionsInSameProjectWarn() {
        let rows = [session("source", .idle), session("other", .working, cwd: "/tmp/project/./"), session("elsewhere", .working, cwd: "/tmp/elsewhere"), session("closed", .saved), session("demo", .working, simulated: true)]
        let activity = WorkspaceActivity(sessions: rows, directory: "/tmp/project", excluding: rows[0].id)
        XCTAssertEqual(activity.working, 1)
        XCTAssertEqual(activity.idle + activity.waiting, 0)
    }
}
