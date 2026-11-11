import XCTest
@testable import SessionCore

final class NavigationAndAlertTests: XCTestCase {
    func testCodexActionRequiredTitleMatchesUniquely() {
        let session = Session(provider: "Codex", sessionID: "one", title: "Investigate AI session tracker MVP",
                              cwd: "/work/agent-session-manager", state: .needsInput)
        let target = TerminalTarget(app: "Terminal", window: "1", identity: "/dev/ttys001",
                                    title: "[ . ] Action Required | Investigate AI session tracker MVP | agent-session-manager")
        XCTAssertEqual(TerminalTarget.uniqueMatch(for: session, sessions: [session], targets: [target]), target)
        XCTAssertEqual(target.matchRank(for: session), 1)
        XCTAssertNil(TerminalTarget.uniqueMatch(for: session, sessions: [session], targets: [target, target]))
        var duplicate = session; duplicate.sessionID = "two"
        XCTAssertNil(TerminalTarget.uniqueMatch(for: session, sessions: [session, duplicate], targets: [target]))
        var otherProvider = session; otherProvider.provider = "Claude"
        XCTAssertFalse(target.matches(otherProvider))
        var inactive = session; inactive.state = .saved
        XCTAssertFalse(target.matches(inactive))
        let wrongFolder = TerminalTarget(app: "Ghostty", window: "2", identity: "pane", title: target.title, cwd: "/elsewhere/project")
        XCTAssertFalse(wrongFolder.matches(session))
        let unrelated = TerminalTarget(app: "Terminal", window: "3", identity: "tty", title: "[ . ] Action Required | Different task | agent-session-manager")
        XCTAssertFalse(unrelated.matches(session))
    }

    func row(_ state: SessionState) -> Session {
        Session(provider: "Codex", sessionID: "id", title: "Implement feature", cwd: "/work/repo", state: state)
    }
    func testCompletionOnlyFromObservedWorkingState() {
        XCTAssertEqual(SessionAlert.transitions(from: [row(.working)], to: [row(.idle)]).first?.kind, .finished)
        for state in [SessionState.idle, .disconnected, .saved, .needsInput] {
            XCTAssertTrue(SessionAlert.transitions(from: [row(state)], to: [row(.idle)]).isEmpty)
        }
        XCTAssertTrue(SessionAlert.transitions(from: [], to: [row(.idle)]).isEmpty)
        var simulated = row(.idle); simulated.simulated = true
        XCTAssertTrue(SessionAlert.transitions(from: [row(.working)], to: [simulated]).isEmpty)
    }
    func testCopilotTerminalIdentityRequiresLiveSession() {
        var session = Session(provider: "Copilot", sessionID: "copilot-id", title: "Task", cwd: "/work/repo", state: .working)
        session.terminalTTY = "/dev/ttys003"
        let target = TerminalTarget(app: "Terminal", window: "1", identity: "/dev/ttys003", title: "GitHub Copilot")
        XCTAssertEqual(TerminalTarget.uniqueMatch(for: session, sessions: [session], targets: [target]), target)
        session.state = .saved
        XCTAssertNil(TerminalTarget.uniqueMatch(for: session, sessions: [session], targets: [target]))
    }
    func testInputAlertsDoNotRepeat() {
        XCTAssertEqual(SessionAlert.transitions(from: [row(.working)], to: [row(.needsInput)]).first?.kind, .input)
        XCTAssertTrue(SessionAlert.transitions(from: [row(.needsInput)], to: [row(.needsInput)]).isEmpty)
    }
    func testUniqueTitleMatchIgnoresCodexSpinner() {
        let target = TerminalTarget(app: "Terminal", window: "123", identity: "/dev/ttys001", title: "⠴ Implement feature | repo")
        XCTAssertEqual(TerminalTarget.uniqueMatch(for: row(.working), sessions: [row(.working)], targets: [target]), target)
        XCTAssertNil(TerminalTarget.uniqueMatch(for: row(.working), sessions: [row(.working)], targets: [target, target]))
        var other = row(.idle); other.sessionID = "other"
        XCTAssertNil(TerminalTarget.uniqueMatch(for: row(.working), sessions: [row(.working), other], targets: [target]))
    }
    func testGhosttyRequiresMatchingWorkingDirectoryAndExactTitle() {
        XCTAssertTrue(TerminalTarget(app: "Ghostty", window: "w", identity: "pane", title: "Implement feature", cwd: "/work/repo").matches(row(.idle)))
        XCTAssertFalse(TerminalTarget(app: "Ghostty", window: "w", identity: "pane", title: "Implement feature", cwd: "/other/repo").matches(row(.idle)))
        XCTAssertFalse(TerminalTarget(app: "Terminal", window: "w", identity: "tty", title: "Different task | repo").matches(row(.idle)))
    }
    func testChooserRanksLiveTTYBeforeTitleAndKeepsOtherTabs() {
        var session = row(.idle)
        session.terminalTTY = "/dev/ttys003"
        let exact = TerminalTarget(app: "Terminal", window: "3", identity: "/dev/ttys003", title: "Shell")
        let title = TerminalTarget(app: "Terminal", window: "2", identity: "/dev/ttys002", title: "Implement feature | repo")
        let other = TerminalTarget(app: "Terminal", window: "1", identity: "/dev/ttys001", title: "Shell")
        XCTAssertEqual(TerminalTarget.ordered([other, title, exact], for: session), [exact, title, other])
        session.state = .saved
        XCTAssertEqual(exact.matchRank(for: session), 2)
        XCTAssertEqual(TerminalTarget.ordered([exact, other, title], for: session), [title, other, exact])
        XCTAssertEqual(TerminalTarget.ordered([title, exact, other], for: session), [title, other, exact])
    }

}
