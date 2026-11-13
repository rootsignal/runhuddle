import XCTest
@testable import SessionCore

final class ShellAgentLinkTests: XCTestCase {
    func row(_ id: String = "one") -> Session {
        Session(provider: "Codex", sessionID: id, title: "Fix loading", cwd: "/work/app", state: .idle)
    }
    func testUniqueForegroundTitleAndFolderMatch() {
        let activity = ShellAgentLink(command: "codex", directory: "/work/app", title: "Fix loading | app", tty: "/dev/ttys1")
        XCTAssertEqual(activity.match([row()])?.id, row().id)
        XCTAssertNil(activity.match([row(), row("two")]))
    }
    func testShellPromptOrDifferentFolderCannotKeepStaleLink() {
        XCTAssertNil(ShellAgentLink(command: "zsh", directory: "/work/app", title: "Fix loading | app", tty: "").match([row()]))
        XCTAssertNil(ShellAgentLink(command: "codex", directory: "/work/other", title: "Fix loading | app", tty: "").match([row()]))
        XCTAssertNil(ShellAgentLink(command: "codex", directory: "/work/app", title: "Unrelated", tty: "").match([row()]))
    }
    func testMacOSFolderAliasesMatchWithoutChangingTheSession() {
        var session = row(); session.cwd = "/tmp"
        let activity = ShellAgentLink(command: "codex", directory: "/private/tmp", title: session.title, tty: "")
        XCTAssertEqual(activity.match([session])?.id, session.id)
        XCTAssertEqual(activity.match([session])?.cwd, "/tmp")
    }
    func testTTYIdentityAndProviderAreRequiredTogether() {
        var session = row(); session.terminalTTY = "/dev/ttys1"
        XCTAssertEqual(ShellAgentLink(command: "codex", directory: "/work/app", title: "", tty: "/dev/ttys1").match([session])?.id, session.id)
        XCTAssertNil(ShellAgentLink(command: "claude", directory: "/work/app", title: session.title, tty: "/dev/ttys1").match([session]))
        session.state = .saved
        XCTAssertNil(ShellAgentLink(command: "codex", directory: "/work/app", title: session.title, tty: "/dev/ttys1").match([session]))
    }
}
