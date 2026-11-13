import SwiftUI
import SessionCore

struct NewSessionLaunchView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openWindow) private var openWindow
    @ViewState private var agents: [String] = []
    @ViewState private var provider = ""
    @ViewState private var directory: String
    @ViewState private var busy = false
    @ViewState private var selectedNotes: Set<UUID> = []
    @ViewState private var notesExpanded = true
    @ViewState private var prompt = ""
    private var projectNotes: [SavedWork] { model.savedWork.filter { $0.belongs(to: directory) } }

    @ViewState private var isolated = false
    @ViewState private var allowShared = false
    @ViewState private var branch = "runhuddle/work-" + String(UUID().uuidString.prefix(8)).lowercased()
    private var workspacePath: String { ProjectWorkspace.destination(directory: (directory as NSString).expandingTildeInPath, suffix: branch.split(separator: "/").last.map(String.init) ?? "work") }
    @ViewState private var failure: String?
    @AppStorage("newSessionAgent") private var preferredAgent = "Codex"
    init(initialDirectory: String = "") {
        _directory = ViewState(initialValue: initialDirectory.isEmpty ? UserDefaults.standard.string(forKey: "newSessionDirectory") ?? "" : initialDirectory)
    }
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 18) {
            Label("New session", systemImage: "plus.bubble").font(.title2.bold())
            Text("Choose an agent and project to start working.")
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
                WorkspaceLaunchOptions(directory: directory, isolated: $isolated, allowShared: $allowShared, branch: $branch, destination: workspacePath)
                if !projectNotes.isEmpty {
                    DisclosureGroup("Include project notes (\(selectedNotes.count) selected)", isExpanded: $notesExpanded) {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(projectNotes) { note in
                                    Toggle(note.title, isOn: Binding(get: { selectedNotes.contains(note.id) }, set: { included in
                                        if included { selectedNotes.insert(note.id) } else { selectedNotes.remove(note.id) }
                                        prompt = SavedWork.referencePrompt(projectNotes.filter { selectedNotes.contains($0.id) })
                                    }))
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.frame(maxHeight: 120)
                        Text("Changing the selection rebuilds the prompt below. Notes are never included automatically.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !selectedNotes.isEmpty {
                    Text("First prompt · add your task and review exactly what will be sent")
                        .font(.caption).foregroundStyle(.secondary)
                    TextEditor(text: $prompt).font(.system(size: 12, design: .monospaced))
                        .frame(height: 180).border(.quaternary).accessibilityLabel("First prompt with selected notes")
                }
                Label("Opens inside RunHuddle", systemImage: "terminal").font(.headline)
                Text("Prompts, approvals, and agent commands run directly in the terminal. Your existing sign-in, model, and permission settings apply.")
                    .font(.callout).foregroundStyle(.secondary)

            }
            if let failure { Text(failure).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(busy)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(provider.isEmpty ? "Start session" : "Start \(provider)") {
                    busy = true; failure = nil
                    let launchPrompt: String? = selectedNotes.isEmpty ? nil : prompt
                    let path = (directory as NSString).expandingTildeInPath
                    Task {
                        do {
                            let chosen = isolated ? try await ProjectWorkspace.create(directory: path, branch: branch, destination: workspacePath) : path
                            if isolated { directory = chosen; isolated = false; allowShared = true }
                            failure = await model.startNewSession(provider: provider, directory: chosen, claudeReplies: false, prompt: launchPrompt)
                        } catch { failure = error.localizedDescription }
                        busy = false
                        if failure == nil {
                            preferredAgent = provider
                            UserDefaults.standard.set((directory as NSString).expandingTildeInPath, forKey: "newSessionDirectory")
                            dismiss()
                        }
                    }
                }.buttonStyle(.borderedProminent).disabled(busy || model.navigatingTerminal || (!selectedNotes.isEmpty && prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) || directory.isEmpty || !agents.contains(provider) || (!isolated && model.hasOpenSession(in: directory) && !allowShared))
            }
        }.padding(24)
        }.frame(width: 580, height: 700).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .onAppear { detect(); projectAgent() }
            .onChange(of: directory) { _, _ in projectAgent(); selectedNotes.removeAll(); prompt = "" }
    }
    private func projectAgent() {
        let choice = ProjectPreferencesStore.shared.value(directory).agent
        if agents.contains(choice) { provider = choice }
    }
    private func detect() {
        agents = model.installedLaunchAgents()
        if !agents.contains(provider) { provider = agents.contains(preferredAgent) ? preferredAgent : agents.first ?? "" }
    }
}
