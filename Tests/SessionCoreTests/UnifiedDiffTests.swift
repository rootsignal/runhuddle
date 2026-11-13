import XCTest
@testable import SessionCore

final class UnifiedDiffTests: XCTestCase {
    func testLineNumbersTrackBothSidesAcrossHunks() {
        let rows = UnifiedDiffLine.parse("--- a/file\n+++ b/file\n@@ -8,2 +8,3 @@\n unchanged\n-old\n+new\n+extra\n@@ -20 +21 @@\n-last\n+replacement")
        XCTAssertEqual(rows[1].kind, .header)
        XCTAssertEqual(rows[3].oldLine, 8)
        XCTAssertEqual(rows[3].newLine, 8)
        XCTAssertEqual(rows[4].oldLine, 9)
        XCTAssertNil(rows[4].newLine)
        XCTAssertEqual(rows[5].newLine, 9)
        XCTAssertEqual(rows[6].newLine, 10)
        XCTAssertEqual(rows[8].oldLine, 20)
        XCTAssertEqual(rows[9].newLine, 21)
    }
    func testContentThatLooksLikeFileHeadersRemainsAChange() {
        let rows = UnifiedDiffLine.parse("@@ -1 +1 @@\n--- old text\n+++ new text\n\\ No newline at end of file")
        XCTAssertEqual(rows[1].kind, .deletion)
        XCTAssertEqual(rows[2].kind, .addition)
        XCTAssertNil(rows[3].newLine)
    }
    func testFileBoundariesAndNewFiles() {
        let rows = UnifiedDiffLine.parse("@@ -0,0 +1,2 @@\n+one\n+two\ndiff --git a/next b/next\n--- a/next\n+++ b/next")
        XCTAssertNil(rows[1].oldLine)
        XCTAssertEqual(rows[1].newLine, 1)
        XCTAssertEqual(rows[2].newLine, 2)
        XCTAssertEqual(rows[4].kind, .header)
        XCTAssertEqual(rows[5].kind, .header)
    }
}
