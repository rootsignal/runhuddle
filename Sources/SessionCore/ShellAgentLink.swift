import Foundation

/// Live PTY evidence only; never infer ownership from a shared project folder.
public struct ShellAgentLink: Equatable {
    public let command: String
    public let directory: String
    public let title: String
    public let tty: String
    public init(command: String, directory: String, title: String, tty: String) {
        self.command = command; self.directory = directory; self.title = title; self.tty = tty
    }
    public func match(_ sessions: [Session]) -> Session? {
        let executable = URL(fileURLWithPath: command).lastPathComponent.lowercased()
        guard let provider = ["codex": "Codex", "claude": "Claude", "copilot": "Copilot"][executable] else { return nil }
        let live = sessions.filter { !$0.simulated && $0.provider == provider && [.working, .idle, .needsInput].contains($0.state) }
        let exact = live.filter { !tty.isEmpty && $0.terminalTTY == tty }
        if !exact.isEmpty { return exact.count == 1 ? exact[0] : nil }
        // Codex's shared feed does not expose its CLI PID/TTY. Require both
        // current folder and full terminal title, with exactly one candidate.
        guard !directory.isEmpty else { return nil }
        let target = TerminalTarget(app: "RunHuddle", window: "", identity: "", title: title, cwd: URL(fileURLWithPath: directory).resolvingSymlinksInPath().path)
        let matches = live.filter { row in
            var normalized = row
            normalized.cwd = URL(fileURLWithPath: row.cwd).resolvingSymlinksInPath().path
            return target.matches(normalized)
        }
        return matches.count == 1 ? matches[0] : nil
    }
}
