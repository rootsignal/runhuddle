import XCTest
@testable import SessionCore

final class TerminalRoutingTests: XCTestCase {
    func testITermPaneTTYAndSafeRememberedChoice() {
        var row = Session(provider: "Claude", sessionID: "one", title: "Task", cwd: "/work/repo", state: .idle)
        row.terminalTTY = "/dev/ttys001"
        let pane = TerminalTarget(app: "iTerm2", window: "1", identity: "uuid", title: "Claude", tty: "/dev/ttys001", applicationPID: 42)
        XCTAssertEqual(TerminalTarget.uniqueMatch(for: row, sessions: [row], targets: [pane]), pane)
        XCTAssertTrue(pane.stillMatchesChoice(pane))
        XCTAssertFalse(TerminalTarget(app: "iTerm2", window: "1", identity: "uuid", title: "Claude", tty: "/dev/ttys001", applicationPID: 43).stillMatchesChoice(pane))
        XCTAssertFalse(TerminalTarget(app: "iTerm2", window: "1", identity: "uuid", title: "Other task", tty: "/dev/ttys001", applicationPID: 42).stillMatchesChoice(pane))
        row.state = .saved
        XCTAssertNil(TerminalTarget.uniqueMatch(for: row, sessions: [row], targets: [pane]))
    }
    func testSavedPeersDoNotBlockLiveExactTitleMatch() {
        let live = Session(provider: "Codex", sessionID: "live", title: "Task", cwd: "/work/repo", state: .idle)
        var old = live; old.sessionID = "saved"; old.state = .saved
        let terminal = TerminalTarget(app: "Terminal", window: "1", identity: "tty", title: "Task | repo")
        XCTAssertNotNil(TerminalTarget.uniqueMatch(for: live, sessions: [live, old], targets: [terminal]))
        old.state = .idle
        XCTAssertNil(TerminalTarget.uniqueMatch(for: live, sessions: [live, old], targets: [terminal]))
    }
    func testTmuxRequiresAttachedClientAndPreservesAmbiguity() {
        let terminal = TerminalTarget(app: "Terminal", window: "1", identity: "/dev/ttys001", title: "tmux", applicationPID: 42)
        let panes = "%2\t/dev/ttys008\t$0\t@1\t/work/repo\tTask\t123\n"
        let clients = "/dev/ttys001\t$0\n"
        let targets = TmuxRoute.targets(panes: panes, clients: clients, terminals: [terminal])
        XCTAssertEqual(targets.count, 1)
        var row = Session(provider: "Claude", sessionID: "one", title: "Task", cwd: "/work/repo", state: .idle)
        row.terminalTTY = "/dev/ttys008"
        XCTAssertEqual(TerminalTarget.uniqueMatch(for: row, sessions: [row], targets: [terminal] + targets), targets[0])
        XCTAssertTrue(TmuxRoute.targets(panes: panes, clients: "", terminals: [terminal]).isEmpty)
        XCTAssertTrue(TmuxRoute.targets(panes: panes.replacingOccurrences(of: "%2", with: "%2;kill-server"), clients: clients, terminals: [terminal]).isEmpty)
        let second = TerminalTarget(app: "Terminal", window: "2", identity: "/dev/ttys002", title: "tmux", applicationPID: 42)
        let both = TmuxRoute.targets(panes: panes, clients: clients + "/dev/ttys002\t$0\n", terminals: [terminal, second])
        XCTAssertNil(TerminalTarget.uniqueMatch(for: row, sessions: [row], targets: both))
    }
}
