import XCTest
@testable import SessionCore

final class ProjectFilterTests: XCTestCase {
    func testTemporaryRootsAndPathBoundaries() {
        for path in ["/tmp/test", "/private/tmp/test", "/private/var/folders/ab/id/T/test", "/var/folders/ab/id/T/test", ""] {
            XCTAssertTrue(ProjectFilter.isTemporary(path), path)
        }
        for path in ["/Users/me/Work/tmp_project", "/Users/me/Work/runhuddle-claude-check", "/tmp-project", "/var/folders-project"] {
            XCTAssertFalse(ProjectFilter.isTemporary(path), path)
        }
    }
    func testOptionsGroupWithoutLosingHistoryMatches() {
        let paths = ["/Users/me/Work/app", "/tmp/one", "/private/tmp/two", "/Users/me/Work/app"]
        XCTAssertEqual(ProjectFilter.options(paths), ["/Users/me/Work/app", ProjectFilter.temporary])
        XCTAssertTrue(ProjectFilter.matches("/tmp/one", selection: ProjectFilter.temporary))
        XCTAssertFalse(ProjectFilter.matches("/Users/me/Work/app", selection: ProjectFilter.temporary))
        let row = Session(provider: "Claude", sessionID: "test", title: "Test", cwd: "/tmp/one", state: .archived)
        XCTAssertTrue(SessionSearchScope.currentView.includes(row, searching: true, filter: "Archived", provider: "All tools", project: ProjectFilter.temporary, pinned: []))
        XCTAssertEqual(ProjectFilter.title(ProjectFilter.temporary), "Temporary / other")
    }
}
