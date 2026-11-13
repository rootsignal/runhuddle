import XCTest
@testable import SessionCore

final class SessionResumePolicyTests: XCTestCase {
    func testExternalAndUncertainResumeRequiresConfirmation() {
        for state: SessionState in [.idle, .working, .needsInput, .disconnected] {
            let row = Session(provider: "Claude", sessionID: "test", title: "test", cwd: "/tmp", state: state)
            XCTAssertFalse(SessionResumePolicy.canLaunch(row))
            XCTAssertTrue(SessionResumePolicy.canLaunch(row, externalConfirmed: true))
        }
    }
    func testConfirmationCannotLaunchDemoSessions() {
        let row = Session(provider: "Claude", sessionID: "test", title: "test", cwd: "/tmp", state: .idle, simulated: true)
        XCTAssertFalse(SessionResumePolicy.canLaunch(row, externalConfirmed: true))
    }
    func testClosedConversationDoesNotRequireOverride() {
        let row = Session(provider: "Claude", sessionID: "test", title: "test", cwd: "/tmp", state: .saved)
        XCTAssertTrue(SessionResumePolicy.canLaunch(row))
    }
}
