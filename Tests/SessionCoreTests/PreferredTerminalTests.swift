import XCTest
@testable import SessionCore

final class PreferredTerminalTests: XCTestCase {
    func testExistingInstallsDefaultToTerminal() {
        XCTAssertEqual(PreferredTerminal.stored(nil), .terminal)
        XCTAssertEqual(PreferredTerminal.stored("unknown"), .terminal)
        for terminal in PreferredTerminal.allCases {
            XCTAssertEqual(PreferredTerminal.stored(terminal.rawValue), terminal)
        }
    }

    func testAppleScriptLiteralRoundTripsCommandsAndPaths() throws {
        let value = "cd -- '/work/Club Spite' && printf '%s' \"quotes\\paths\"\n$HOME `literal` café"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", "return " + PreferredTerminal.appleScriptLiteral(value)]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), value + "\n")
    }

    func testNativeLaunchCreatesNewSurfaceWithFullCommand() {
        let command = "cd -- '/work/Club Spite' && '/bin/agent' '--resume' 'session-id'"
        for terminal in [PreferredTerminal.iterm2, .ghostty] {
            for tab in [true, false] {
                let script = terminal.creationScript(command: command, cwd: "/work/Club Spite", preferTab: tab)!
                XCTAssertTrue(script.contains(PreferredTerminal.appleScriptLiteral("/bin/zsh -lc " + ShellCommand.quote(command))))
                XCTAssertTrue(script.contains("if \(tab ? "true" : "false") and (count of windows) > 0"))
                XCTAssertFalse(script.contains("write text"))
                XCTAssertFalse(script.contains("input text"))
                if terminal == .ghostty {
                    XCTAssertTrue(script.contains("set initial working directory of cfg to \"/work/Club Spite\""))
                    XCTAssertTrue(script.contains("new window with configuration cfg"))
                } else {
                    XCTAssertTrue(script.contains("create window with default profile command"))
                }
            }
        }
        XCTAssertNil(PreferredTerminal.terminal.creationScript(command: command, cwd: "/work/Club Spite", preferTab: true))
    }
}
