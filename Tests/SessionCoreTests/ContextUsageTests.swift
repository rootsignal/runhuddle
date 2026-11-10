import XCTest
@testable import SessionCore

final class ContextUsageTests: XCTestCase {
    func testFractionAndInvalidValues() {
        XCTAssertEqual(ContextUsage(used: 120, limit: 100).fraction, 1.2)
        XCTAssertNil(ContextUsage(used: 10, limit: 0).fraction)
        XCTAssertNil(ContextUsage(used: -1, limit: 100).fraction)
    }
    func testOldSessionSnapshotsDecodeWithoutContext() throws {
        let session = Session(provider: "Codex", sessionID: "test", title: "Title", cwd: "/tmp", state: .idle)
        let data = try JSONEncoder().encode(session)
        XCTAssertNil(try JSONDecoder().decode(Session.self, from: data).contextUsage)
    }
}
