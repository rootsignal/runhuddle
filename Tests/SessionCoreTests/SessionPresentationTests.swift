import XCTest
@testable import SessionCore

final class SessionPresentationTests: XCTestCase {
    func testNowShowsOnlyLiveActivityRegardlessOfOldHistory() {
        for state in SessionState.allCases {
            let row = Session(provider: "Claude", sessionID: "x", title: "Test", cwd: "/tmp", state: state, updated: 1)
            XCTAssertEqual(SessionPresentation.includes(row, filter: "Now"), [.working, .idle, .needsInput].contains(state))
        }
    }
    func testPinnedDoesNotResurrectArchiveAndKeepsProviderIdentity() {
        var row = Session(provider: "Claude", sessionID: "x", title: "Test", cwd: "/tmp", state: .saved)
        XCTAssertFalse(SessionPresentation.includes(row, filter: "Pinned", pinned: ["Codex:x"]))
        XCTAssertTrue(SessionPresentation.includes(row, filter: "Pinned", pinned: [row.id]))
        row.state = .archived
        XCTAssertFalse(SessionPresentation.includes(row, filter: "Pinned", pinned: [row.id]))
    }
    func testExcerptCollapsesWhitespaceAndPreservesReadableUnicode() {
        XCTAssertEqual(SessionPresentation.excerpt("Hello\n\n  world 🐾"), "Hello world 🐾")
        XCTAssertEqual(SessionPresentation.excerpt("One two three four", limit: 10), "One two…")
        XCTAssertEqual(SessionPresentation.excerpt(""), "")
    }
    func testDetachedStatusDoesNotClaimWorkHasStopped() {
        var row = Session(provider: "Claude", sessionID: "x", title: "Test", cwd: "/tmp", state: .disconnected)
        row.reason = "Process has no controlling terminal"
        XCTAssertEqual(SessionPresentation.statusSummary(row), "Terminal detached · current activity is unconfirmed")
        row.reason = "Provider unavailable"
        XCTAssertEqual(SessionPresentation.statusSummary(row), "Live status could not be confirmed")
        row.state = .working
        XCTAssertEqual(SessionPresentation.statusSummary(row), "Claude reports work in progress")
    }

}
