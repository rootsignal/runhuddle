import XCTest
@testable import SessionCore

final class HookEventWatcherTests: XCTestCase {
    @MainActor func testSignalCreationAndAtomicReplacementWakeOnlyMatchingProvider() async throws {
        // Resolve /var -> /private/var so FSEvents and the watched path use the same spelling.
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let signal = root.appendingPathComponent("claude.sqlite.signal")
        let first = expectation(description: "Signal created")
        let second = expectation(description: "Signal replaced")
        var count = 0
        let watcher = HookEventWatcher(paths: [signal.path: "Claude"]) { providers in
            XCTAssertEqual(providers, ["Claude"])
            count += 1
            if count == 1 { first.fulfill() }
            if count == 2 { second.fulfill() }
        }
        XCTAssertTrue(watcher.start())
        defer { watcher.stop() }
        try Data().write(to: root.appendingPathComponent("claude.sqlite"))
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(count, 0, "Snapshot database writes must not wake the observer")
        try Data("one".utf8).write(to: signal)
        await fulfillment(of: [first], timeout: 5)
        try Data("two".utf8).write(to: signal, options: .atomic)
        await fulfillment(of: [second], timeout: 5)
    }
}
