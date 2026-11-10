import XCTest
@testable import SessionCore

final class HandoffContextTests: XCTestCase {
    func testLegacyContextDecodesWithoutActivityFields() throws {
        let data = Data(#"{"text":"Old handoff", "updated":123}"#.utf8)
        let context = try JSONDecoder().decode(HandoffContext.self, from: data)
        XCTAssertNil(context.latestRequest)
        XCTAssertNil(context.latestResponse)
        XCTAssertEqual(context.text, "Old handoff")
    }
    func testPurposeAndNextStepPersistIndependentlyOfRecordedActivity() throws {
        let store = try Store(path: ":memory:")
        try store.save(["Codex:a": SessionBrief(purpose: "Build tracker", nextStep: "Verify login")], key: "sessionBriefs")
        try store.save(["Codex:a": HandoffContext(text: "Latest response", latestResponse: "Agent reported a failure")], key: "handoffContexts")
        let notes = try store.load([String: SessionBrief].self, key: "sessionBriefs")
        XCTAssertEqual(notes?["Codex:a"]?.purpose, "Build tracker")
        XCTAssertEqual(notes?["Codex:a"]?.nextStep, "Verify login")
    }

    func testRefreshNeverRewritesNotesOrLegacyRecordedSections() {
        let notes = "My decisions\n\n## Recorded continuation context\nAn edited legacy section"
        let context = HandoffContext(text: "New transcript", updated: Date(timeIntervalSince1970: 100))
        let result = HandoffContext.compose(notes: notes, context: context, failure: nil)
        XCTAssertTrue(result.hasPrefix(notes))
        XCTAssertTrue(result.hasSuffix("New transcript"))
        XCTAssertFalse(result.contains("Using cached context"))
    }
    func testFailedRefreshLabelsCachedAndMissingContext() {
        let cached = HandoffContext.compose(notes: "Notes", context: HandoffContext(text: "Earlier transcript"), failure: "Offline")
        XCTAssertTrue(cached.contains("Using cached context"))
        XCTAssertTrue(cached.contains("Earlier transcript"))
        let missing = HandoffContext.compose(notes: "Notes", context: nil, failure: "Offline")
        XCTAssertTrue(missing.contains("No recorded context is available"))
        XCTAssertFalse(missing.contains("## Recorded continuation context"))
    }
    func testContextPersistsSeparatelyFromEditableDraft() throws {
        let store = try Store(path: ":memory:")
        let notes = ["Codex:id": "Keep my notes"]
        try store.save(notes, key: "drafts")
        let context = HandoffContext(text: "Fresh transcript", updated: Date(timeIntervalSince1970: 123))
        try store.save(["Codex:id": context], key: "handoffContexts")
        XCTAssertEqual(try store.load([String: String].self, key: "drafts"), notes)
        let restored = try XCTUnwrap(store.load([String: HandoffContext].self, key: "handoffContexts")?["Codex:id"])
        XCTAssertEqual(restored.text, context.text)
        XCTAssertEqual(restored.updated, context.updated)
    }
}
