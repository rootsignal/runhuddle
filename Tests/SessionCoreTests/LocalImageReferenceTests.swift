import XCTest
@testable import SessionCore

final class LocalImageReferenceTests: XCTestCase {
    func testScreenshotPathWithSpacesAndTrailingPunctuation() {
        let path = "/var/folders/temp/Screenshot 2026-11-11 at 10.04.18 AM.png"
        let text = path + ". What do you think?"
        let refs = LocalImageReference.extract(from: text)
        XCTAssertEqual(refs.map(\.path), [path])
        XCTAssertEqual(LocalImageReference.displayText(text, references: refs), "[Image]. What do you think?")
        XCTAssertEqual(LocalImageReference.prompt(text:"Check this",paths:[path]), "Check this\n\n" + path)
    }
    func testMultiplePathsURLsAndDeduplication() {
        let refs = LocalImageReference.extract(from:"\"/tmp/one.png\"\nfile:///tmp/two%20words.jpg\n/tmp/one.png")
        XCTAssertEqual(refs.map(\.path), ["/tmp/one.png", "/tmp/two words.jpg"])
    }
    func testRemoteURLsAndNonImagesAreNotLocalReferences() {
        XCTAssertTrue(LocalImageReference.extract(from:"https://example.com/image.png /tmp/file.txt").isEmpty)
        XCTAssertTrue(LocalImageReference.extract(from:"file://remotehost/tmp/image.png").isEmpty)
    }
    func testImageOnlyPromptRetainsPath() {
        XCTAssertEqual(LocalImageReference.prompt(text:"",paths:["/tmp/a.png"]), "/tmp/a.png")
    }
}
