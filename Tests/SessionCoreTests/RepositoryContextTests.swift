import XCTest
@testable import SessionCore

final class RepositoryContextTests: XCTestCase {
    func testPorcelainRenameAndUnusualNames() {
        let status = "R  new name\0old name\0?? line\nbreak\0 M modified\0"
        XCTAssertEqual(RepositoryContext.changedFileCount(Data(status.utf8)), 3)
        XCTAssertEqual(RepositoryContext.changedFileCount(Data()), 0)
    }
    func testRealRepositoryAndLinkedWorktree() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        func git(_ args: [String]) throws {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = ["-C", root.path] + args
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run(); process.waitUntilExit()
            XCTAssertEqual(process.terminationStatus, 0)
        }
        try git(["init", "-b", "main"])
        var context = try await RepositoryContext.read(at: root.path)
        XCTAssertEqual(context.branch, "main") // unborn branch
        XCTAssertEqual(context.changedFiles, 0)
        try Data("hello".utf8).write(to: root.appendingPathComponent("file"))
        try git(["add", "."])
        try git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "Initial"])
        try Data("changed".utf8).write(to: root.appendingPathComponent("file"))
        try Data().write(to: root.appendingPathComponent("untracked"))
        context = try await RepositoryContext.read(at: root.path)
        XCTAssertEqual(context.changedFiles, 2)
        XCTAssertFalse(context.linkedWorktree)
        let linked = root.appendingPathComponent("linked")
        try git(["worktree", "add", "--detach", linked.path])
        let detached = try await RepositoryContext.read(at: linked.path)
        XCTAssertTrue(detached.linkedWorktree)
        XCTAssertTrue(detached.branch.hasPrefix("Detached HEAD · "))
        XCTAssertEqual(detached.changedFiles, 0)
    }
    func testMissingDirectory() async {
        do { _ = try await RepositoryContext.read(at: "/nonexistent/\(UUID())"); XCTFail("Expected failure") }
        catch { }
    }
}
