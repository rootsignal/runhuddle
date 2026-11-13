import XCTest
@testable import SessionCore

final class SessionSearchScopeTests: XCTestCase {
    func testEverywhereIncludesAllStatesButRespectsExplicitFilters() {
        for provider in ["Codex", "Claude", "Copilot"] {
            for state in SessionState.allCases {
                let row = Session(provider: provider, sessionID: "x", title: "Test", cwd: "/other", state: state)
                XCTAssertTrue(SessionSearchScope.everywhere.includes(row, searching: true, filter: "Pinned", provider: "All tools", project: "All projects", pinned: []))
                XCTAssertFalse(SessionSearchScope.everywhere.includes(row, searching: true, filter: "Running here", provider: "Different", project: "All projects", pinned: []))
                XCTAssertFalse(SessionSearchScope.everywhere.includes(row, searching: true, filter: "Running here", provider: "All tools", project: "/selected", pinned: []))
                XCTAssertTrue(SessionSearchScope.everywhere.includes(row, searching: true, filter: "Running here", provider: provider, project: "/other", pinned: []))
            }
        }
    }
    func testUnconfirmedSessionsAreExplicitlyUnknownAndExcludedFromNow() {
        let row = Session(provider: "Claude", sessionID: "x", title: "Test", cwd: "/project", state: .disconnected)
        XCTAssertEqual(row.state.title, "Status unknown")
        XCTAssertNotEqual(row.state.title, SessionState.saved.title)
        XCTAssertFalse(SessionPresentation.includes(row, filter: "Running here"))
        XCTAssertTrue(SessionPresentation.includes(row, filter: "All sessions"))
    }
    func testCurrentViewKeepsAllFilters() {
        let row = Session(provider: "Claude", sessionID: "x", title: "Test", cwd: "/project", state: .archived)
        XCTAssertTrue(SessionSearchScope.currentView.includes(row, searching: true, filter: "Archived", provider: "Claude", project: "/project", pinned: []))
        for (filter, provider, project) in [("Running here", "Claude", "/project"), ("Archived", "Codex", "/project"), ("Archived", "Claude", "/other")] {
            XCTAssertFalse(SessionSearchScope.currentView.includes(row, searching: true, filter: filter, provider: provider, project: project, pinned: []))
        }
    }
    func testBrowsingDoesNotIncludeArchiveOrBroadenNow() {
        for scope in SessionSearchScope.allCases {
            let row = Session(provider: "Codex", sessionID: "x", title: "Test", cwd: "/project", state: .archived)
            XCTAssertFalse(scope.includes(row, searching: false, filter: "All sessions", provider: "All tools", project: "All projects", pinned: []))
            var saved = row; saved.state = .saved
            XCTAssertFalse(scope.includes(saved, searching: false, filter: "Running here", provider: "All tools", project: "All projects", pinned: []))
            XCTAssertEqual(scope.includes(saved, searching: true, filter: "Running here", provider: "All tools", project: "All projects", pinned: []), scope == .everywhere)
        }
    }
}
