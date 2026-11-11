import Foundation
import SessionCore

@MainActor enum TmuxNavigator {
    static var executable: String? {
        ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", NSHomeDirectory() + "/.local/bin/tmux"].first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    static func run(_ arguments: [String]) async throws -> String {
        guard let executable else { throw TerminalNavigator.failure("tmux is not installed in a supported location.") }
        return try await Task.detached {
            let process = Process(), output = Pipe(), errors = Pipe()
            process.executableURL = URL(fileURLWithPath: executable)
            process.arguments = ["-N"] + arguments
            process.standardOutput = output; process.standardError = errors
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 3, execute: timeout)
            defer { timeout.cancel() }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw NSError(domain: "tmux", code: 1, userInfo: [NSLocalizedDescriptionKey: "The tmux server or pane is no longer available."]) }
            return String(decoding: data, as: UTF8.self)
        }.value
    }
    static func discover(_ terminals: [TerminalTarget]) async -> [TerminalTarget] {
        guard executable != nil else { return [] }
        do {
            let panes = try await run(["list-panes", "-a", "-F", "#{pane_id}\t#{pane_tty}\t#{session_id}\t#{window_id}\t#{pane_current_path}\t#{pane_title}\t#{pid}"])
            let clients = try await run(["list-clients", "-F", "#{client_tty}\t#{session_id}"])
            return TmuxRoute.targets(panes: panes, clients: clients, terminals: terminals)
        } catch { return [] }
    }
    static func focus(_ target: TerminalTarget) async throws {
        guard let route = target.tmux else { return }
        let outer = TerminalTarget(app: target.app, window: target.window, identity: target.identity, title: target.title, cwd: target.cwd, tty: target.tty, applicationPID: target.applicationPID)
        let current = await discover([outer])
        guard current.contains(target) else { throw TerminalNavigator.failure("The tmux pane or attached client changed. Refresh and choose it again.") }
        try await TerminalNavigator.focus(outer)
        // Numeric tmux IDs were validated by TmuxRoute. No shell command or key input.
        _ = try await run(["select-window", "-t", route.session + ":" + route.window, ";", "select-pane", "-t", route.pane])
    }
}
