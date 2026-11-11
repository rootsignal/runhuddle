import XCTest
@testable import SessionCore

final class GeneratedHandoffTests: XCTestCase {
    func testLegacyDraftIsHiddenUntilAnAIHandoffExists() {
        XCTAssertEqual(GeneratedHandoff.visibleText(draft: "Old assembled template", generated: nil), "")
        let summary = GeneratedHandoff(text: "AI summary", provider: "Codex", sessionUpdated: 10, sourceFingerprint: "source")
        XCTAssertEqual(GeneratedHandoff.visibleText(draft: nil, generated: summary), "AI summary")
        XCTAssertEqual(GeneratedHandoff.visibleText(draft: "My edits", generated: summary), "My edits")
        XCTAssertEqual(GeneratedHandoff.visibleText(draft: "", generated: summary), "")
    }
    func testStalenessDependsOnActivityAndNotesNotFetchTime() {
        let fingerprint = GeneratedHandoff.fingerprint(context: "history", purpose: "goal", nextStep: "ship")
        let summary = GeneratedHandoff(text: "AI brief", provider: "Codex", sessionUpdated: 10, sourceFingerprint: fingerprint)
        XCTAssertFalse(summary.isStale(sessionUpdated: 10, fingerprint: fingerprint))
        XCTAssertTrue(summary.isStale(sessionUpdated: 11, fingerprint: fingerprint))
        XCTAssertTrue(summary.isStale(sessionUpdated: 10, fingerprint: GeneratedHandoff.fingerprint(context: "history", purpose: "new goal", nextStep: "ship")))
        XCTAssertTrue(summary.hasEdits("My changes"))
        XCTAssertFalse(summary.hasEdits("AI brief"))
    }
    func testDraftAndMetadataTransactionRollsBackTogether() throws {
        let store = try Store(path: ":memory:")
        try store.save("original", key: "draft")
        enum Failure: Error { case simulated }
        XCTAssertThrowsError(try store.transaction {
            try store.save("replacement", key: "draft")
            try store.save("new metadata", key: "generation")
            throw Failure.simulated
        })
        XCTAssertEqual(try store.load(String.self, key: "draft"), "original")
        XCTAssertNil(try store.load(String.self, key: "generation"))
    }
}
