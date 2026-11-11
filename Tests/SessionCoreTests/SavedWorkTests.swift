import XCTest
@testable import SessionCore

final class SavedWorkTests: XCTestCase {
    func testIndependentRecordSurvivesSourceDeletionAndRestart() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let path = folder.appendingPathComponent("store.sqlite").path
        let session = Session(provider: "Claude", sessionID: "original", title: "Billing", cwd: "/work/billing", state: .archived)
        var record = SavedWork(session: session, title: "Billing decisions", text: "Chose integer cents to avoid rounding errors.")
        record.generatedBy = "Codex"; record.generatedAt = Date(timeIntervalSince1970: 1000)
        do {
            let store = try Store(path: path)
            try store.save([session], key: "sessions")
            try store.save([record], key: "savedWorkLibrary")
            try store.save([Session](), key: "sessions")
            for key in ["drafts", "sessionBriefs", "generatedHandoffs"] { try store.save([String: String](), key: key) }
        }
        let reopened = try Store(path: path)
        XCTAssertEqual(try reopened.load([SavedWork].self, key: "savedWorkLibrary"), [record])
        XCTAssertEqual(try reopened.load([Session].self, key: "sessions"), [])
    }
    func testSearchAndExportRetainProvenance() {
        let session = Session(provider: "Copilot", sessionID: "source-id", title: "Task", cwd: "/work/billing", state: .saved, updated: 500)
        let record = SavedWork(session: session, title: "Currency decision", text: "Integer cents; tests passed per agent report.", kind: "Handoff", sourceUpdated: 400)
        XCTAssertTrue(record.matches("billing INTEGER"))
        XCTAssertTrue(record.matches("copilot source-id"))
        XCTAssertFalse(record.matches("billing bananas"))
        XCTAssertTrue(record.markdown.contains("Source: Copilot / source-id"))
        XCTAssertTrue(record.markdown.contains("agent report"))
        XCTAssertEqual(record.sourceUpdated, 400)
    }
    func testSnapshotsGetIndependentIdentities() {
        let session = Session(provider: "Codex", sessionID: "same", title: "Task", cwd: "/work", state: .saved)
        let first = SavedWork(session: session, title: "First", text: "First outcome")
        let second = SavedWork(session: session, title: "Second", text: "Later outcome")
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(first.sourceID, second.sourceID)
    }
}
