import Foundation
import XCTest
@testable import SessionCore

final class StoreWriteTests: XCTestCase {
    func testUnchangedDictionariesDoNotGrowWAL() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let path = folder.appendingPathComponent("state.sqlite").path
        let store = try Store(path: path)
        func walSize() throws -> UInt64 {
            (try FileManager.default.attributesOfItem(atPath: path + "-wal")[.size] as! NSNumber).uint64Value
        }
        try store.save(["a": "first", "b": "second"], key: "contexts")
        let initial = try walSize()
        for _ in 0..<30 {
            var reversed = [String: String]()
            reversed["b"] = "second"; reversed["a"] = "first"
            try store.save(reversed, key: "contexts")
        }
        XCTAssertEqual(try walSize(), initial)
        try store.save(["a": "changed"], key: "contexts")
        XCTAssertGreaterThan(try walSize(), initial)
        XCTAssertEqual(try store.load([String: String].self, key: "contexts"), ["a": "changed"])
    }

    func testRolledBackWriteCanBeSavedAgain() throws {
        let store = try Store(path: ":memory:")
        enum Failure: Error { case rollback }
        try store.save("before", key: "state")
        XCTAssertThrowsError(try store.transaction {
            try store.save("after", key: "state")
            throw Failure.rollback
        })
        XCTAssertEqual(try store.load(String.self, key: "state"), "before")
        try store.save("after", key: "state")
        XCTAssertEqual(try store.load(String.self, key: "state"), "after")
    }
}
