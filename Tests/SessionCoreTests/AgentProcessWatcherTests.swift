import XCTest
@testable import SessionCore

final class AgentProcessWatcherTests: XCTestCase {
    func testDiscoveryRecognizesTerminalAgentsWithoutMatchingSharedServersOrShells() {
        let rows = AgentProcessWatcher.terminalProcesses("""
        100 ttys001 /opt/homebrew/bin/codex
        101 ?? /package/bin/codex
        102 ttys002 /Users/me/.local/bin/claude
        103 ttys003 copilot
        104 ttys004 copilot-cli
        105 ttys001 /bin/zsh
        106 ttys001 /usr/local/bin/node
        107 ttys001 /tmp/not-codex
        bad input
        """)
        XCTAssertEqual(rows, [100: "Codex", 102: "Claude", 103: "Copilot", 104: "Copilot"])
    }

    @MainActor func testProcessExitInvalidatesProviderExactlyOnce() async throws {
        let exited = expectation(description: "exit event")
        exited.assertForOverFulfill = true
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["0.3"]
        try child.run()
        var providers: [String] = []
        let watcher = AgentProcessWatcher { provider in providers.append(provider); exited.fulfill() }
        watcher.update([child.processIdentifier: "Codex"])
        watcher.update([child.processIdentifier: "Codex"])
        await fulfillment(of: [exited], timeout: 3)
        watcher.stop()
        XCTAssertEqual(providers, ["Codex"])
    }

    @MainActor func testStoppingWatcherDoesNotEmitExit() async throws {
        let exited = expectation(description: "no exit after stop")
        exited.isInverted = true
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["0.2"]
        try child.run()
        let watcher = AgentProcessWatcher { _ in exited.fulfill() }
        watcher.update([child.processIdentifier: "Claude"])
        watcher.stop()
        await fulfillment(of: [exited], timeout: 0.5)
    }
}
