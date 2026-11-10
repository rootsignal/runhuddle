import XCTest
@testable import SessionCore

final class SessionCoreTests: XCTestCase {
    func testRestartInvalidatesLiveStatusAndExcludesDemo() throws {
        let live = Session(provider: "Codex", sessionID: "live", title: "Live", cwd: "/tmp", state: .needsInput)
        let saved = Session(provider: "Codex", sessionID: "saved", title: "Saved", cwd: "/tmp", state: .saved)
        let demo = Session(provider: "Claude", sessionID: "demo", title: "Demo", cwd: "/tmp", state: .working, simulated: true)
        let restored = Recovery.restore([live, saved, demo])
        XCTAssertEqual(restored.map(\.state), [.disconnected, .saved])
        XCTAssertEqual(restored.map(\.sessionID), ["live", "saved"])
        XCTAssertEqual(Recovery.offline([demo], reason: "lost").first?.state, .working)
    }

    func testRecoveryAfterConnectionLossKeepsIdentity() {
        let row = Session(provider: "Codex", sessionID: "one", title: "Work", cwd: "/work/tree", state: .working)
        let offline = Recovery.offline([row], reason: "lost")
        XCTAssertEqual(offline.first?.id, row.id)
        XCTAssertEqual(offline.first?.cwd, row.cwd)
        XCTAssertEqual(offline.first?.state, .disconnected)
        // A fresh provider snapshot replaces stale runtime state without changing identity.
        var reconnected = row
        reconnected.state = .idle
        XCTAssertEqual(reconnected.id, offline.first?.id)
    }
    func testPersistenceSurvivesReopeningAndKeepsDraftSeparate() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let path = folder.appendingPathComponent("test.sqlite").path
        let row = Session(provider: "Codex", sessionID: "one", title: "First", cwd: "/tmp/test", state: .working)
        do {
            let store = try Store(path: path)
            try store.save([row], key: "sessions")
            try store.save([row.id: "My reviewed handoff"], key: "drafts")
        }
        let reopened = try Store(path: path)
        XCTAssertEqual(try reopened.load([Session].self, key: "sessions"), [row])
        try reopened.save([Session](), key: "sessions")
        XCTAssertEqual(try reopened.load([String: String].self, key: "drafts")?[row.id], "My reviewed handoff")
    }

    func testSearchFindsExactWorktreeAndBranch() {
        let row = Session(provider: "Codex", sessionID: "one", title: "Fix login", cwd: "/Work/repo-worktree", project: "repo", branch: "fix/auth", state: .idle)
        XCTAssertTrue(row.matches("REPO-WORKTREE"))
        XCTAssertTrue(row.matches("fix/auth"))
        XCTAssertFalse(row.matches("unrelated"))
    }

    func testClaudeLifecycle() {
        let sequence: [ClaudeEvent] = [.sessionStart, .prompt, .permission, .toolFinished, .question, .stop, .end]
        XCTAssertEqual(sequence.map(\.state), [.idle, .working, .needsInput, .working, .needsInput, .idle, .saved])
    }

    func testResumeDoesNotExecuteUntrustedPath() throws {
        let value = "/tmp/a' $(touch /tmp/should-not-run); `echo nope`\nnext"
        let script = "printf '%s' " + ShellCommand.quote(value)
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script]; process.standardOutput = pipe
        try process.run()
        let result = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        XCTAssertEqual(String(data: result, encoding: .utf8), value)
        let demo = Session(provider: "Claude", sessionID: "demo", title: "Demo", cwd: "/tmp", state: .idle, simulated: true)
        XCTAssertNil(ShellCommand.resume(demo, executable: "/bin/claude"))
    }

    func testHandoffPreservesIdentityWithoutClaimingVerification() {
        let row = Session(provider: "Codex", sessionID: "source", title: "Fix", cwd: "/work", preview: "Implement login", state: .idle)
        XCTAssertTrue(row.handoff.contains("Codex / source"))
        XCTAssertTrue(row.handoff.contains("No verification results have been inferred"))
    }
}
