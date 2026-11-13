import Foundation
import Darwin
import SessionCore

enum TerminalStartError: Error { case message(String) }

@main struct Check {
    static func main() throws {
        let root = URL(fileURLWithPath: "/tmp/rh-env-" + String(UUID().uuidString.prefix(8)))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let oldHome = ProcessInfo.processInfo.environment["HOME"]
        let old = ProcessInfo.processInfo.environment["ZDOTDIR"]
        setenv("HOME", root.path, 1)
        setenv("ZDOTDIR", root.path, 1)
        defer {
            if let oldHome { setenv("HOME", oldHome, 1) }
            if let old { setenv("ZDOTDIR", old, 1) } else { unsetenv("ZDOTDIR") }
            try? FileManager.default.removeItem(at: root)
        }
        try "export RH_INTERACTIVE_FIXTURE=overwritten\n".write(to: root.appendingPathComponent(".zshenv"), atomically: true, encoding: .utf8)
        try "export RH_LOGIN_FIXTURE=login\n".write(to: root.appendingPathComponent(".zprofile"), atomically: true, encoding: .utf8)
        try "export RH_INTERACTIVE_FIXTURE=interactive\n".write(to: root.appendingPathComponent(".zshrc"), atomically: true, encoding: .utf8)
        try "export RH_LOGIN_FIXTURE=login\n. \"$HOME/.bashrc\"\n".write(to: root.appendingPathComponent(".bash_profile"), atomically: true, encoding: .utf8)
        try "export RH_INTERACTIVE_FIXTURE=interactive\n".write(to: root.appendingPathComponent(".bashrc"), atomically: true, encoding: .utf8)
        try "setenv RH_LOGIN_FIXTURE login\n".write(to: root.appendingPathComponent(".login"), atomically: true, encoding: .utf8)
        try "setenv RH_INTERACTIVE_FIXTURE interactive\n".write(to: root.appendingPathComponent(".tcshrc"), atomically: true, encoding: .utf8)
        let shim = root.appendingPathComponent("agent")
        try "#!/bin/sh\nprintf '%s\\n' \"$RH_LOGIN_FIXTURE\" \"$RH_INTERACTIVE_FIXTURE\" \"$@\" > result\n".write(to: shim, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: shim.path)
        for shell in ["/bin/zsh", "/bin/bash", "/bin/tcsh"] {
        let service = PersistentTerminalService(folder: root.appendingPathComponent(URL(fileURLWithPath: shell).lastPathComponent), runtimeExecutable: ProcessInfo.processInfo.environment["RUNHUDDLE_TMUX"], loginShell: shell)
        defer { _ = try? service.run(["kill-server"]) }
        for provider in ["Codex", "Claude", "Copilot"] {
            for resume in [false, true] {
                let record = try service.create(executable: shim.path, directory: root.path, provider: provider,
                                                resume: resume ? "session-fixture" : nil, prompt: resume ? nil : "literal $value 'quotes'")
                defer { try? service.remove(record) }
                let deadline = Date().addingTimeInterval(8)
                while !(try service.pane(record).dead) && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
                let actual = try String(contentsOf: root.appendingPathComponent("result"), encoding: .utf8)
                let arguments = resume ? (provider == "Codex" ? "resume\n" : "--resume\n") + "session-fixture\n"
                    : (provider == "Copilot" ? "-i\n" : "") + "literal $value 'quotes'\n"
                guard actual == "login\ninteractive\n" + arguments else {
                    throw TerminalStartError.message("\(provider) \(resume ? "resume" : "new") failed shell environment or exact argument check: \(actual.debugDescription)")
                }
                if shell == "/bin/zsh" && provider == "Claude" && resume {
                    // Use the production argument path with an explicitly ASCII locale.
                    // A control-mode attachment exposes the same client UTF-8 flag.
                    let client = Process()
                    client.executableURL = URL(fileURLWithPath: service.executable)
                    client.arguments = service.baseArguments + ["-C", "attach-session", "-t", record.name]
                    client.environment = service.environment.merging(["LANG": "C", "LC_ALL": "C"]) { _, new in new }
                    let input = Pipe(), output = Pipe()
                    client.standardInput = input; client.standardOutput = output; client.standardError = output
                    try client.run()
                    defer { if client.isRunning { client.terminate(); client.waitUntilExit() } }
                    let limit = Date().addingTimeInterval(3)
                    var flags = ""
                    repeat {
                        flags = try service.run(["list-clients", "-t", record.name, "-F", "#{client_utf8}"])
                        if flags == "1" { break }
                        Thread.sleep(forTimeInterval: 0.05)
                    } while Date() < limit
                    guard flags == "1" else { throw TerminalStartError.message("ASCII-locale attachment did not enable UTF-8") }
                    print("ASCII locale: restored tmux attachment advertises UTF-8")
                }
                print("\(shell) \(provider) \(resume ? "resume" : "new"): login + interactive environment; exact arguments; no permission overrides")
            }
        }
        }
    }
}
