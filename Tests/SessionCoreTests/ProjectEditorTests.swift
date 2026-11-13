import XCTest
@testable import SessionCore

final class ProjectEditorTests: XCTestCase {
    func testDetectionPreferenceAndMissingExplicitChoice() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        func app(_ name: String) throws -> URL {
            let application = root.appendingPathComponent(name + ".app")
            let contents = application.appendingPathComponent("Contents")
            let bin = contents.appendingPathComponent("MacOS")
            try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
            let plist = ["CFBundleIdentifier": "test." + UUID().uuidString, "CFBundleName": name, "CFBundleExecutable": "editor", "CFBundlePackageType": "APPL"]
            try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: contents.appendingPathComponent("Info.plist"))
            let executable = bin.appendingPathComponent("editor")
            try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
            return application
        }
        let code = try app("Visual Studio Code")
        let cursor = try app("Cursor")
        let custom = try app("My Editor")
        let installed = ProjectEditor.discover(in: [root, root])
        XCTAssertEqual(installed.count, 2)
        XCTAssertEqual(ProjectEditor.preferred(path: "", installed: installed)?.path, code.path)
        XCTAssertEqual(ProjectEditor.preferred(path: "", installed: installed)?.name, "VS Code")
        XCTAssertEqual(ProjectEditor.preferred(path: cursor.path, installed: installed)?.path, cursor.path)
        XCTAssertEqual(ProjectEditor.preferred(path: custom.path, installed: installed)?.path, custom.path)
        XCTAssertNil(ProjectEditor.preferred(path: root.appendingPathComponent("Missing.app").path, installed: installed))
        XCTAssertNil(ProjectEditor(application: root))
    }
}
