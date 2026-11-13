import XCTest
@testable import SessionCore

final class SessionChainTests: XCTestCase {
    private func row(_ id: String, _ state: SessionState = .saved) -> Session {
        Session(provider: "Codex", sessionID: id, title: id, cwd: "/project", state: state)
    }
    func testChainCollapsesClosedPredecessorsAndSurvivesStorage() throws {
        let a = row("a"), b = row("b"), c = row("c", .idle)
        let links = [b.id: SessionContinuation(sourceID: a.id, sourceTitle: "A", createdAt: 1),
                     c.id: SessionContinuation(sourceID: b.id, sourceTitle: "B", createdAt: 2)]
        let restored = try JSONDecoder().decode([String: SessionContinuation].self, from: JSONEncoder().encode(links))
        XCTAssertEqual(SessionChain.ancestors(of: c.id, links: restored), [b.id, a.id])
        XCTAssertEqual(SessionChain.groups(rows: [a, b, c], links: restored, pinned: [])[c.id]?.map(\.id), [b.id, a.id])
        XCTAssertFalse(SessionChain.canLink(child: a.id, parent: c.id, links: links))
        XCTAssertFalse(SessionChain.canLink(child: a.id, parent: a.id, links: links))
    }
    func testForksDoNotDuplicateAncestorsOrHideWorkingPinnedAndFilteredSessions() {
        let a = row("a"), b = row("b", .working), c = row("c")
        let links = [b.id: SessionContinuation(sourceID: a.id, sourceTitle: "A", createdAt: 1),
                     c.id: SessionContinuation(sourceID: a.id, sourceTitle: "A", createdAt: 2)]
        let groups = SessionChain.groups(rows: [a, b, c], links: links, pinned: [])
        XCTAssertEqual(groups[c.id]?.map(\.id), [a.id])
        XCTAssertNil(groups[b.id])
        XCTAssertTrue(SessionChain.groups(rows: [a, b, c], links: links, pinned: [a.id]).isEmpty)
        XCTAssertTrue(SessionChain.groups(rows: [a], links: links, pinned: []).isEmpty)
        XCTAssertEqual(SessionChain.groups(rows: [row("a", .idle), b, c], links: links, pinned: [])[c.id]?.map(\.id), [a.id])
        for state: SessionState in [.working, .needsInput] {
            XCTAssertTrue(SessionChain.groups(rows: [row("a", state), b, c], links: links, pinned: []).isEmpty)
        }
        XCTAssertTrue(SessionChain.groups(rows: [row("a", .idle), b, c], links: links, pinned: [a.id]).isEmpty)
    }
    func testExactHistoricalHandoffHeaderAndMissingAncestors() {
        let id = UUID().uuidString
        let prompt = "Continue from this handoff. First inspect the current project state.\n\n# Handoff: RunHuddle\n\nSource: Codex / \(id)\nProject: /project\n"
        let link = SessionContinuation.fromHandoff(prompt)
        XCTAssertEqual(link?.sourceID, "Codex:" + id)
        XCTAssertEqual(link?.sourceTitle, "RunHuddle")
        XCTAssertNil(SessionContinuation.fromHandoff("A quoted example:\n" + prompt))
        XCTAssertNil(SessionContinuation.fromHandoff(prompt.replacingOccurrences(of: id, with: "not-an-id")))
        let current = row("current")
        XCTAssertTrue(SessionChain.groups(rows: [current], links: [current.id: link!], pinned: []).isEmpty)
    }
}
