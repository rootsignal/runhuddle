import XCTest
@testable import SessionCore

final class WorkspaceFeaturesTests: XCTestCase {
    private func repo() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        _ = try ProjectGit.run(url.path, ["init", "-b", "main"])
        _ = try ProjectGit.run(url.path, ["config", "user.name", "Test"])
        _ = try ProjectGit.run(url.path, ["config", "user.email", "test@example.invalid"])
        return url
    }
    private func write(_ text: String, _ name: String, _ root: URL) throws { try text.write(to: root.appendingPathComponent(name), atomically: true, encoding: .utf8) }
    func testChangesUnbornStagedAndUntrackedSpecialPaths() async throws {
        let root = try repo()
        try write("one\n", "staged.txt", root)
        _ = try ProjectGit.run(root.path, ["add", "--", "staged.txt"])
        try write("one\ntwo\n", "staged.txt", root)
        try write("literal\n", ":(glob)*\tfile\n.txt", root)
        let changes = try await ProjectChanges.read(root.path)
        XCTAssertEqual(changes.files.count, 2)
        XCTAssertNil(changes.ahead)
        let staged = try XCTUnwrap(changes.files.first { $0.path == "staged.txt" })
        XCTAssertEqual(staged.additions, "2")
        let diff = try await changes.diff(staged)
        XCTAssertTrue(diff.contains("+two"))
        let unusual = try XCTUnwrap(changes.files.first { $0.status == "??" })
        XCTAssertEqual(unusual.additions, "1")
        let untrackedDiff = try await changes.diff(unusual)
        XCTAssertTrue(untrackedDiff.contains("literal"))
    }
    func testRenameBinaryAndNoExternalDiff() async throws {
        let root = try repo()
        try write("original\n", "before.txt", root)
        _ = try ProjectGit.run(root.path, ["add", "."])
        _ = try ProjectGit.run(root.path, ["commit", "-m", "initial"])
        _ = try ProjectGit.run(root.path, ["mv", "before.txt", "after.txt"])
        try Data([0, 1, 2]).write(to: root.appendingPathComponent("binary"))
        _ = try ProjectGit.run(root.path, ["config", "diff.external", "/usr/bin/false"])
        let changes = try await ProjectChanges.read(root.path)
        let renamed = try XCTUnwrap(changes.files.first { $0.path == "after.txt" })
        XCTAssertEqual(renamed.original, "before.txt")
        let diff = try await changes.diff(renamed)
        XCTAssertTrue(diff.contains("original"))
        let binary = try XCTUnwrap(changes.files.first { $0.path == "binary" })
        let binaryText = try await changes.diff(binary)
        XCTAssertTrue(binaryText.contains("Binary"))
    }
    func testIsolatedWorkspaceDoesNotCopyDirtyFiles() async throws {
        let root = try repo()
        try write("committed\n", "file", root)
        _ = try ProjectGit.run(root.path, ["add", "."])
        _ = try ProjectGit.run(root.path, ["commit", "-m", "initial"])
        try write("dirty\n", "file", root)
        let target = root.appendingPathComponent("isolated").path
        let path = try await ProjectWorkspace.create(directory: root.path, branch: "runhuddle/test", destination: target)
        XCTAssertEqual(try String(contentsOfFile: path + "/file", encoding: .utf8), "committed\n")
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("file"), encoding: .utf8), "dirty\n")
        XCTAssertEqual(try ProjectGit.text(path, ["branch", "--show-current"]), "runhuddle/test")
        do { _ = try await ProjectWorkspace.create(directory: root.path, branch: "again", destination: target); XCTFail("Must not replace an existing folder") } catch {}
    }
    func testCleanDoesNotMeanPushedAndDetachedHasNoUpstreamClaim() async throws {
        let root = try repo()
        try write("one\n", "file", root)
        _ = try ProjectGit.run(root.path, ["add", "."])
        _ = try ProjectGit.run(root.path, ["commit", "-m", "initial"])
        _ = try ProjectGit.run(root.path, ["remote", "add", "origin", root.path + "/unused-remote"])
        _ = try ProjectGit.run(root.path, ["update-ref", "refs/remotes/origin/main", "HEAD"])
        _ = try ProjectGit.run(root.path, ["branch", "--set-upstream-to=origin/main", "main"])
        try write("two\n", "file", root)
        _ = try ProjectGit.run(root.path, ["commit", "-am", "local change"])
        let clean = try await ProjectChanges.read(root.path)
        XCTAssertTrue(clean.files.isEmpty)
        XCTAssertEqual(clean.ahead, 1)
        XCTAssertEqual(clean.behind, 0)
        _ = try ProjectGit.run(root.path, ["checkout", "--detach"])
        let detached = try await ProjectChanges.read(root.path)
        XCTAssertNil(detached.upstream)
        XCTAssertNil(detached.ahead)
        XCTAssertEqual(detached.branch, "Detached HEAD")
    }
    func testIndependentReviewUsesSelectedDirtyChangesWithoutHandoff() async throws {
        let root = try repo()
        try write("original\n", "chosen.txt", root)
        _ = try ProjectGit.run(root.path, ["add", "."])
        _ = try ProjectGit.run(root.path, ["commit", "-m", "initial"])
        try write("changed-for-review\n", "chosen.txt", root)
        try write("UNSELECTED_PRIVATE_TEXT\n", "other.txt", root)
        let changes = try await ProjectChanges.read(root.path)
        let request = try await ProjectReview.prepare(changes: changes, selectedPaths: ["chosen.txt"], context: "Fix file loading", focus: "Check error handling")
        XCTAssertEqual(request.directory, changes.root)
        XCTAssertTrue(FileManager.default.contentsEqual(atPath: request.directory + "/chosen.txt", andPath: root.appendingPathComponent("chosen.txt").path))
        XCTAssertEqual(request.fileCount, 1)
        XCTAssertFalse(request.prompt.contains("changed-for-review"))
        XCTAssertTrue(request.prompt.contains("chosen.txt"))
        XCTAssertTrue(request.prompt.contains("Check error handling"))
        XCTAssertTrue(request.prompt.contains("Do not modify files"))
        XCTAssertFalse(request.prompt.contains("UNSELECTED_PRIVATE_TEXT"))
        XCTAssertFalse(request.prompt.contains("Continue from this handoff"))
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent("chosen.txt"), encoding: .utf8), "changed-for-review\n")
        do {
            _ = try await ProjectReview.prepare(changes: changes, selectedPaths: [], context: "", focus: "")
            XCTFail("An empty scope must not start a review")
        } catch {}
    }
    func testReviewReadsNoFileContentsAndKeepsAllScopeCompact() async throws {
        let root = try repo()
        try write(String(repeating: "large diff evidence\n", count: 6000), "large.txt", root)
        let changes = try await ProjectChanges.read(root.path, includeLineCounts: false)
        XCTAssertEqual(changes.files.first?.additions, "—")
        try FileManager.default.removeItem(at: root.appendingPathComponent("large.txt"))
        let request = try await ProjectReview.prepare(changes: changes, selectedPaths: ["large.txt"], context: "Task", focus: "")
        XCTAssertFalse(request.prompt.contains("large diff evidence"))
        XCTAssertTrue(request.prompt.contains("All current uncommitted changes"))
        XCTAssertLessThan(request.prompt.utf8.count, 3_000)
    }
    func testReviewLargeAllScopeAndExactSubsetLimits() async throws {
        let paths = (0..<300).map { "file-\($0)-" + String(repeating: "x", count: 100) }
        let changes = ProjectChanges(root: "/tmp", branch: "main", revision: "abc", upstream: nil, ahead: nil, behind: nil, checkedAt: Date(), files: paths.map { ProjectChangedFile(path: $0, original: nil, status: "??") })
        let all = try await ProjectReview.prepare(changes: changes, selectedPaths: Set(paths), context: "", focus: "")
        XCTAssertLessThan(all.prompt.utf8.count, 3_000)
        XCTAssertEqual(all.fileCount, 300)
        do {
            _ = try await ProjectReview.prepare(changes: changes, selectedPaths: Set(paths.dropLast()), context: "", focus: "")
            XCTFail("Do not silently truncate selected filenames")
        } catch {}
        do {
            _ = try await ProjectReview.prepare(changes: changes, selectedPaths: Set(paths), context: String(repeating: "x", count: 3001), focus: "")
            XCTFail("Do not silently truncate task context")
        } catch {}
    }

    func testInboxReadingDoesNotResolveApprovalsAndNewResultsBecomeUnread() throws {
        let working = Session(provider: "Codex", sessionID: "one", title: "Work", cwd: "/tmp", state: .working)
        var idle = working; idle.state = .idle
        var entries = AttentionInbox.updating([], previous: [working], current: [idle])
        XCTAssertEqual(entries.count, 1)
        entries = AttentionInbox.reading(entries, sessionID: working.id)
        XCTAssertTrue(entries[0].read)
        entries = AttentionInbox.updating(entries, previous: [working], current: [idle])
        XCTAssertFalse(entries[0].read)
        var waiting = idle; waiting.state = .needsInput
        XCTAssertEqual(AttentionInbox.updating(entries, previous: [idle], current: [waiting]), entries)
        XCTAssertEqual(waiting.state, .needsInput)
        XCTAssertEqual(try JSONDecoder().decode([InboxEntry].self, from: JSONEncoder().encode(entries)), entries)
    }
    func testReviewLinksDoNotHideSourceSessions() {
        let source = Session(provider: "Codex", sessionID: "source", title: "Source", cwd: "/tmp", state: .idle)
        let review = Session(provider: "Claude", sessionID: "review", title: "Review", cwd: "/tmp", state: .idle)
        let link = SessionContinuation(sourceID: source.id, sourceTitle: source.title, relationship: "reviewed")
        XCTAssertEqual(link.sourceLabel, "Review of")
        XCTAssertTrue(SessionChain.groups(rows: [source, review], links: [review.id: link], pinned: []).isEmpty)
        XCTAssertEqual(SessionChain.ancestors(of: review.id, links: [review.id: link]), [source.id])
    }
    func testProjectPreferencesLinksAndCanonicalPaths() {
        XCTAssertNil(ProjectPreferences.link("javascript:alert(1)"))
        XCTAssertNil(ProjectPreferences.link("file:///tmp/private"))
        XCTAssertNotNil(ProjectPreferences.link("http://localhost:3000"))
        XCTAssertEqual(ProjectPreferences.key("/tmp/project/../project"), ProjectPreferences.key("/tmp/project"))
    }
}
