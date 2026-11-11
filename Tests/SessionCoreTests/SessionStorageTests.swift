import XCTest
@testable import SessionCore

final class SessionStorageTests: XCTestCase {
    func testTotalsDeduplicateSharedFilesAndReportUnavailable() {
        var a = Session(provider: "Codex", sessionID: "a", title: "A", cwd: "/work", state: .archived)
        a.storage = SessionStorage(bytes: 100, allocatedBytes: 4096, fileID: "1:2", checkedAt: 0)
        var b = a; b.sessionID = "b"
        var c = a; c.sessionID = "c"; c.storage = nil
        let result = SessionStorageTotal([a, b, c])
        XCTAssertEqual(result.allocatedBytes, 4096)
        XCTAssertEqual(result.measured, 2)
        XCTAssertEqual(result.unavailable, 1)
        XCTAssertTrue(result.label.contains("1 unavailable"))
        XCTAssertEqual(SessionStorageTotal([c]).label, "Transcript storage unavailable")
    }
}
