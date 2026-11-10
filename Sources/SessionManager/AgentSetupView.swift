import SwiftUI

struct AgentSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var installed: [String: String] = [:]
    @State private var socketFound = false
    @State private var hooksFound = false
    @State private var installing = false
    @State private var message: String?

    private var onDiskImage: Bool { Bundle.main.bundlePath.hasPrefix("/Volumes/") }
    private var copilotHome: URL {
        URL(fileURLWithPath: ProcessInfo.processInfo.environment["COPILOT_HOME"] ?? NSHomeDirectory() + "/.copilot")
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Connect your agents").font(.title.bold())
            Text("RunHuddle includes everything it needs to run. Your coding agents and their accounts are managed separately.")
                .foregroundStyle(.secondary)
            GroupBox {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Codex").font(.headline)
                    Text(socketFound ? "Local server socket found. RunHuddle will check for sessions." : "Start your usual Codex CLI session with its shared local server to connect.")
                    executable("codex")
                }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
            GroupBox {
                VStack(alignment: .leading, spacing: 8) {
                    Text("GitHub Copilot CLI").font(.headline)
                    executable("copilot")
                    Text("Enable activity hooks to track work and completion. Restart existing Copilot sessions afterward.")
                    Button(installing ? "Enabling…" : hooksFound ? "Update Copilot tracking" : "Enable Copilot tracking") {
                        installing = true; message = nil
                        Task {
                            do {
                                _ = try await Bridge.run(["install-hooks"], provider: "Copilot")
                                message = "Tracking enabled. Restart existing Copilot sessions to load the hooks."
                            } catch { message = error.localizedDescription }
                            installing = false; detect()
                        }
                    }.disabled(installing || onDiskImage)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
            GroupBox {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Claude Code").font(.headline)
                    executable("claude")
                    Text("Live integration is coming later. Current Claude sessions are demo data only.")
                }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
            }
            if onDiskImage { Text("Drag RunHuddle to Applications and open it there before enabling tracking.").foregroundStyle(.orange) }
            if let message { Text(message).font(.callout).textSelection(.enabled) }
            HStack {
                Button("Check again") { detect() }.disabled(installing)
                Spacer()
                Button("Done") {
                    UserDefaults.standard.set(true, forKey: "agentSetupCompleted")
                    dismiss()
                }.keyboardShortcut(.defaultAction).disabled(installing)
            }
        }.padding(24).frame(width: 520).onAppear { detect() }
    }
    private func executable(_ name: String) -> some View {
        Text(installed[name].map { "CLI found: \($0)" } ?? "CLI not found in standard locations.")
            .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
    }
    private func detect() {
        let paths = [NSHomeDirectory() + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.npm-global/bin"]
            + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        installed = [:]
        for name in ["codex", "copilot", "claude"] {
            installed[name] = paths.map { $0 + "/" + name }.first { FileManager.default.isExecutableFile(atPath: $0) }
        }
        let codexHome = ProcessInfo.processInfo.environment["CODEX_HOME"] ?? NSHomeDirectory() + "/.codex"
        socketFound = FileManager.default.fileExists(atPath: codexHome + "/app-server-control/app-server-control.sock")
        hooksFound = FileManager.default.fileExists(atPath: copilotHome.appendingPathComponent("hooks/agent-session-manager.json").path)
    }
}
