import SwiftUI

struct NewSessionLaunchView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @ViewState private var agents: [String] = []
    @ViewState private var provider = ""
    @ViewState private var directory: String
    @ViewState private var busy = false
    @ViewState private var failure: String?
    @ViewState private var copilotMessage: String?
    @AppStorage("newSessionAgent") private var preferredAgent = "Codex"
    @AppStorage("newSessionClaudeReplies") private var claudeReplies = true
    init(initialDirectory: String = "") {
        _directory = ViewState(initialValue: initialDirectory.isEmpty ? UserDefaults.standard.string(forKey: "newSessionDirectory") ?? "" : initialDirectory)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("New session", systemImage: "plus.bubble").font(.title2.bold())
            Text("Start work in your preferred terminal. RunHuddle will track the conversation here.")
                .foregroundStyle(.secondary)
            if agents.isEmpty {
                Label("No supported agents detected", systemImage: "info.circle").font(.headline)
                Text("Install and sign in to Codex, Claude Code, or GitHub Copilot CLI, then check again.")
                    .font(.callout).foregroundStyle(.secondary)
                Button("Check again") { detect() }
            } else {
                Picker("Agent", selection: $provider) {
                    ForEach(agents, id: \.self) { Text($0 == "Claude" ? "Claude Code" : $0 == "Copilot" ? "GitHub Copilot" : $0).tag($0) }
                }.pickerStyle(.segmented)
                HStack {
                    TextField("Project folder", text: $directory).textFieldStyle(.roundedBorder)
                    Button("Choose…") {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
                        if panel.runModal() == .OK, let url = panel.url { directory = url.path }
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    if provider == "Claude" {
                        Toggle("Enable replies in RunHuddle", isOn: $claudeReplies)
                        if claudeReplies {
                            Label("Experimental Claude connection", systemImage: "info.circle").font(.headline)
                            Text("Accept RunHuddle’s development channel when Claude asks in the terminal. You can then send follow-ups here. Your model and permission settings still apply; approvals stay in the terminal.")
                            Text("Claude sessions started normally outside RunHuddle don’t have this reply connection.")
                        } else {
                            Text("Conversation viewing and terminal switching are available. To send follow-ups here, enable replies before launching.")
                        }
                    } else if provider == "Codex" {
                        Label("Replies supported", systemImage: "bubble.left.and.text.bubble.right").font(.headline)
                        Text("Send follow-ups from Activity once the session connects. Approvals stay in the terminal.")
                    } else {
                        Label("Replies included", systemImage: "bubble.left.and.text.bubble.right").font(.headline)
                        Text("RunHuddle installs its reply extension and starts Copilot with experimental extension support. No setup commands needed. Your model and approval settings still apply; approvals stay in the terminal.")
                    }
                }.font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).padding(14)
                    .background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 10))
            }
            if let failure { Text(failure).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(busy)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(provider.isEmpty ? "Start session" : "Start \(provider)") {
                    busy = true; failure = nil
                    let path = (directory as NSString).expandingTildeInPath
                    Task {
                        failure = await model.startNewSession(provider: provider, directory: path, claudeReplies: claudeReplies)
                        busy = false
                        if failure == nil {
                            preferredAgent = provider
                            UserDefaults.standard.set(path, forKey: "newSessionDirectory")
                            dismiss()
                        }
                    }
                }.buttonStyle(.borderedProminent).disabled(busy || model.navigatingTerminal || directory.isEmpty || !agents.contains(provider))
            }
        }.padding(24).frame(width: 530).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .onAppear { detect() }
    }
    private func detect() {
        agents = model.installedLaunchAgents()
        if !agents.contains(provider) { provider = agents.contains(preferredAgent) ? preferredAgent : agents.first ?? "" }
    }
}
