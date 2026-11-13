import Foundation
import Darwin
import SessionCore

struct PersistentTerminalRecord: Codable, Identifiable {
    let id: String
    let provider: String
    let directory: String
    var sessionID: String?
    var title: String
    var name: String { "rh_" + id.replacingOccurrences(of: "-", with: "") }
}
struct TerminalMigration: Codable {
    let provider: String
    let directory: String
    let sessionID: String
    let previousPID: Int32
}
struct PersistentPane {
    let pid: Int32
    let dead: Bool
    let exitCode: Int32?
}

/// A dedicated tmux server owns PTYs. RunHuddle's SwiftTerm views are clients only.
/// The socket and registry never refer to the user's ordinary tmux server.
final class PersistentTerminalService {
    static let shared = PersistentTerminalService()
    let folder: URL
    private let runtimeExecutable: String?
    private let configuredLoginShell: String?
    var agentShell: String { configuredLoginShell ?? Self.loginShell }
    var socket: String { folder.appendingPathComponent("terminals.sock").path }
    private var registry: URL { folder.appendingPathComponent("terminals.json") }
    private var configuration: URL { folder.appendingPathComponent("tmux.conf") }
    init(folder: URL? = nil, runtimeExecutable: String? = nil, loginShell: String? = nil) {
        self.configuredLoginShell = loginShell
        self.runtimeExecutable = runtimeExecutable
        self.folder = folder ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("RunHuddle")
    }
    var executable: String {
        if let runtimeExecutable { return runtimeExecutable }
        if let resource = Bundle.main.resourceURL?.appendingPathComponent("terminal-runtime/bin/tmux"), FileManager.default.isExecutableFile(atPath: resource.path) { return resource.path }
        return ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "/usr/bin/false"
    }
    var environment: [String: String] {
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "TMUX")
        // Build/automation hosts commonly set NO_COLOR for logs. It must not
        // leak into an interactive agent terminal, where users choose colors.
        env.removeValue(forKey: "NO_COLOR")
        env["TERM"] = "xterm-256color"; env["COLORTERM"] = "truecolor"
        let terminfo = URL(fileURLWithPath: executable).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("share/terminfo")
        if FileManager.default.fileExists(atPath: terminfo.path) { env["TERMINFO"] = terminfo.path }
        return env
    }
    var baseArguments: [String] { ["-S", socket, "-f", configuration.path] }
    func prepare() throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: folder.path)
        guard socket.utf8.count < 104 else { throw TerminalStartError.message("The terminal socket path is too long.") }
        try """
        set -g default-terminal xterm-256color
        set -g status off
        set -g mouse on
        set -g prefix None
        set -g prefix2 None
        set -g set-titles on
        set -g set-titles-string '#{pane_title}'
        set -g history-limit 50000
        set -g remain-on-exit on
        set -g exit-empty on
        set -g escape-time 0
        set -g focus-events on
        set -g allow-passthrough on
        set -g terminal-features 'xterm*:RGB:clipboard'
        """.write(to: configuration, atomically: true, encoding: .utf8)
    }
    @discardableResult func run(_ arguments: [String]) throws -> String {
        let process = Process(), output = Pipe(), errors = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = baseArguments + arguments
        process.environment = environment
        process.standardOutput = output; process.standardError = errors
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let errorData = errors.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw TerminalStartError.message(String(decoding: errorData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .newlines)
    }
    func records() throws -> [PersistentTerminalRecord] {
        guard FileManager.default.fileExists(atPath: registry.path) else { return [] }
        return try JSONDecoder().decode([PersistentTerminalRecord].self, from: Data(contentsOf: registry)).filter {
            UUID(uuidString: $0.id) != nil && ["Codex", "Claude", "Copilot", "Shell"].contains($0.provider)
        }
    }
    func save(_ records: [PersistentTerminalRecord]) throws {
        try JSONEncoder().encode(records).write(to: registry, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: registry.path)
    }
    func remember(_ record: PersistentTerminalRecord) throws {
        var all = try records(); all.removeAll { $0.id == record.id }; all.append(record); try save(all)
    }
    private func launchScript(_ record: PersistentTerminalRecord) -> URL {
        folder.appendingPathComponent("launch-" + record.id + ".zsh")
    }
    static var loginShell: String {
        if let raw = getpwuid(getuid())?.pointee.pw_shell {
            let shell = String(cString: raw)
            if shell.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: shell) { return shell }
        }
        return "/bin/zsh"
    }
    static func loginInvocation(shell: String, command: String) -> [String] {
        // csh/tcsh forbid combining -l with other options. A leading dash in
        // argv[0] selects login startup without changing the command's quoting.
        if ["csh", "tcsh"].contains(URL(fileURLWithPath: shell).lastPathComponent) {
            let words = ["exec", "-a", "-" + URL(fileURLWithPath: shell).lastPathComponent, shell, "-i", "-c", command]
            return ["/bin/zsh", "-c", words.map(ShellCommand.quote).joined(separator: " ")]
        }
        return [shell, "-l", "-i", "-c", command]
    }

    func create(executable: String, directory: String, provider: String, resume: String?, prompt: String?) throws -> PersistentTerminalRecord {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw TerminalStartError.message("Choose an existing project folder.")
        }
        guard prompt?.utf8.contains(0) != true else { throw TerminalStartError.message("The initial prompt contains an unsupported null character.") }
        try prepare()
        let record = PersistentTerminalRecord(id: UUID().uuidString, provider: provider, directory: directory, sessionID: resume, title: (provider == "Shell" ? "Shell · " : "") + URL(fileURLWithPath: directory).lastPathComponent)
        var arguments = [executable]
        if provider == "Shell" {
            guard resume == nil, prompt == nil else { throw TerminalStartError.message("Shell terminals do not accept agent prompts or resume IDs.") }
            arguments += ["-l", "-i"]
        }
        if let resume { arguments += provider == "Codex" ? ["resume", resume] : ["--resume", resume] }
        if let prompt { arguments += provider == "Copilot" ? ["-i", prompt] : [prompt] }
        let script = launchScript(record)
        // tmux's command message has a much smaller limit than an agent's argv.
        // Send only a private script path through tmux; zsh passes the exact prompt
        // directly to the CLI. Exec preserves the pane PID used for lifecycle tracking.
        let command = "#!/bin/zsh\n/bin/rm -f -- " + ShellCommand.quote(script.path) + "\nexec " + arguments.map(ShellCommand.quote).joined(separator: " ") + "\n"
        // Store identity before launch so a UI crash cannot orphan a running pane.
        try remember(record)
        do {
            guard FileManager.default.createFile(atPath: script.path, contents: Data(command.utf8), attributes: [.posixPermissions: 0o600]) else {
                throw TerminalStartError.message("Could not prepare the session’s launch file.")
            }
            // A server launched by an older build may still retain this flag.
            _ = try? run(["set-environment", "-gu", "NO_COLOR"])
            // Match a regular terminal: provider startup needs both login and
            // interactive shell configuration (including .zshrc exports).
            let startup = provider == "Shell" ? ["/bin/zsh", script.path]
                : Self.loginInvocation(shell: agentShell, command: "exec /bin/zsh " + ShellCommand.quote(script.path))
            try run(["new-session", "-d", "-s", record.name, "-c", directory, "-x", "100", "-y", "32", "-e", "TERM_PROGRAM=RunHuddle", "-e", "COLORTERM=truecolor"] + startup)
            return record
        } catch {
            try? remove(record)
            throw error
        }
    }
    func pane(_ record: PersistentTerminalRecord) throws -> PersistentPane {
        let fields = try run(["display-message", "-p", "-t", record.name + ":0.0", "#{pane_pid}|#{pane_dead}|#{pane_dead_status}"]).split(separator: "|", omittingEmptySubsequences: false)
        guard fields.count == 3, let pid = Int32(fields[0]) else { throw TerminalStartError.message("Terminal process status is unavailable.") }
        return PersistentPane(pid: pid, dead: fields[1] == "1", exitCode: Int32(fields[2]))
    }
    func shellActivity(_ record: PersistentTerminalRecord) throws -> ShellAgentLink {
        // tmux display-message escapes control bytes (e.g. US becomes \037).
        // A fresh printable delimiter survives transport and avoids field collisions.
        let separator = "|RunHuddle-" + UUID().uuidString + "|"
        let format = ["#{pane_current_command}", "#{pane_current_path}", "#{pane_title}", "#{pane_tty}"].joined(separator: separator)
        let fields = try run(["display-message", "-p", "-t", record.name + ":0.0", format]).components(separatedBy: separator)
        guard fields.count == 4 else { throw TerminalStartError.message("Terminal activity is unavailable.") }
        return ShellAgentLink(command: fields[0], directory: fields[1], title: fields[2], tty: fields[3])
    }
    func remove(_ record: PersistentTerminalRecord) throws {
        // Never use kill-server: other RunHuddle sessions must remain untouched.
        _ = try? run(["kill-session", "-t", record.name])
        if FileManager.default.fileExists(atPath: launchScript(record).path) { try FileManager.default.removeItem(at: launchScript(record)) }
        try save(records().filter { $0.id != record.id })
    }
}
