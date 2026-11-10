import SwiftUI

struct AgentSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var model: AppModel
    @ViewState private var installed: [String: String] = [:]
    @ViewState private var busy = false
    @ViewState private var message: String?
    @ViewState private var copilot: CopilotTrackingStatus?
    private var onDiskImage: Bool { Bundle.main.bundlePath.hasPrefix("/Volumes/") }
    private var detected: [String] {
        ["Codex", "Claude", "Copilot"].filter { installed[$0.lowercased()] != nil || hasSessions($0) }
    }
    private func hasSessions(_ provider: String) -> Bool {
        model.sessions.contains { $0.provider == provider && !$0.simulated }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Connections").font(.title.bold())
            Text("RunHuddle finds your installed coding agents and local sessions automatically.")
                .foregroundStyle(.secondary)
            ForEach(["Codex", "Claude", "Copilot"], id: \.self) { provider in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: detected.contains(provider) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(detected.contains(provider) ? Color.green : Color.secondary)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(provider == "Claude" ? "Claude Code" : provider == "Copilot" ? "GitHub Copilot CLI" : provider).font(.headline)
                        Text(status(provider)).font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
            if detected.isEmpty {
                Text("Install and sign in to your preferred coding agent, then choose Check again.")

            }
            if onDiskImage {
                Text("Drag RunHuddle to Applications and open it there to connect your agents.").foregroundStyle(.orange)
            }
            if let error = model.copilotConnectionError {
                Text(error).font(.callout).foregroundStyle(.orange)
                Button("Retry Copilot connection") { Task { await model.ensureCopilotTracking(retry: true); await detect() } }
                    .disabled(model.connectingCopilot)
            }
            if let error = model.claudeRepairError {
                Text(error).font(.callout).foregroundStyle(.orange)
                Button("Repair Claude tracking paths") { Task { await model.repairClaudeTracking(retry: true) } }
            }
            if let notice = model.claudeRepairNotice { Text(notice).font(.callout) }
            if let notice = model.copilotConnectionNotice { Text(notice).font(.callout) }
            if let message { Text(message).font(.callout).textSelection(.enabled) }
            DisclosureGroup("Connection details") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(installed.keys.sorted(), id: \.self) { name in
                        Text("\(name): \(installed[name] ?? "")").textSelection(.enabled)
                    }
                    if detected.contains("Claude") {
                        Button("Enable Claude compatibility hooks") { Task { await connect() } }.disabled(busy || onDiskImage)
                    }
                    Text("Codex uses its shared local server. Claude uses its live session list when supported, with hooks as a fallback. Copilot hooks load when its CLI starts.")
                }.font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button("Check again") { Task { await detect() } }.disabled(busy)
                Spacer()
                Button("Done") { finish() }.keyboardShortcut(.defaultAction).disabled(busy)

            }
        }.padding(24).frame(width: 520).task { await detect() }
    }
    private func status(_ provider: String) -> String {
        guard detected.contains(provider) else { return "Not detected yet" }
        let active = model.sessions.filter { $0.provider == provider && !$0.simulated && [.working, .idle, .needsInput].contains($0.state) }.count
        if active > 0 { return "Connected · \(active) active \(active == 1 ? "session" : "sessions")" }
        if provider == "Copilot" {
            if copilot?.configured == true {
                return copilot?.lastEvent != nil ? "Tracking enabled · events received" : "Tracking enabled · waiting for a new CLI session"
            }
            return "Detected · ready to connect"
        }
        if provider == "Claude" { return "Detected · existing sessions are discovered on supported CLI versions" }
        return "Detected · connects through the local shared server"
    }
    private func finish() {
        UserDefaults.standard.set(true, forKey: "agentSetupCompleted")
        dismiss()
    }
    private func connect() async {
        busy = true; message = nil
        defer { busy = false }
        do {
            _ = try await Bridge.run(["install-hooks"], provider: "Claude")
            message = "Claude compatibility hooks enabled. Older Claude versions may need a restart/resume to load them."
        } catch { message = error.localizedDescription }
        await detect()
        await model.refresh()
    }
    private func detect() async {
        await model.ensureCopilotTracking()
        let paths = [NSHomeDirectory() + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", NSHomeDirectory() + "/.npm-global/bin"]
            + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        installed = [:]
        for name in ["codex", "copilot", "claude"] {
            installed[name] = paths.map { $0 + "/" + name }.first { FileManager.default.isExecutableFile(atPath: $0) }
        }
        do {
            let data = try await Bridge.run(["diagnostics"], provider: "Copilot")
            copilot = try JSONDecoder().decode(CopilotTrackingStatus.self, from: data)
        } catch { copilot = nil }
    }
}
