import XCTest
@testable import SessionCore

final class AgentPlanTests: XCTestCase {
    func testProgressIsReportedNotInferredFromSessionState() throws {
        let json = #"{"steps":[{"id":"1","text":"Inspect","status":"completed"},{"id":"2","text":"Test","status":"inProgress"},{"id":"3","text":"Ship","status":"pending"}],"source":"Codex plan","reportedAt":"2026-11-12T12:00:00Z","newerRequest":false}"#
        let plan = try JSONDecoder().decode(AgentPlan.self, from: Data(json.utf8))
        XCTAssertEqual(plan.completedCount, 1)
        XCTAssertEqual(plan.currentStep?.text, "Test")
        XCTAssertEqual(plan.countSummary, "1 of 3 steps reported complete")
        XCTAssertNotNil(plan.reportedDate)
        XCTAssertEqual(try JSONDecoder().decode(AgentPlan.self, from: JSONEncoder().encode(plan)), plan)
        let blocked = try JSONDecoder().decode(AgentPlan.self, from: Data(json.replacingOccurrences(of: "inProgress", with: "blocked").utf8))
        XCTAssertNil(blocked.currentStep)
        XCTAssertEqual(blocked.completedCount, 1)
        XCTAssertThrowsError(try JSONDecoder().decode(AgentPlan.self, from: Data(json.replacingOccurrences(of: "inProgress", with: "guessed").utf8)))
    }
    func testOldSavedSessionWithoutPlanStillDecodes() throws {
        let original = Session(provider: "Codex", sessionID: "one", title: "Task", cwd: "/project", state: .idle)
        let decoded = try JSONDecoder().decode(Session.self, from: JSONEncoder().encode(original))
        XCTAssertNil(decoded.agentPlan)
    }
}
