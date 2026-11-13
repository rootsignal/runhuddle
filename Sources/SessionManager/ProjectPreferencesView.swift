import SwiftUI
import SessionCore

@MainActor final class ProjectPreferencesStore: ObservableObject {
    static let shared = ProjectPreferencesStore()
    @Published private var projects: [String: ProjectPreferences] = (UserDefaults.standard.data(forKey: "projectPreferences").flatMap { try? JSONDecoder().decode([String: ProjectPreferences].self, from: $0) }) ?? [:]
    func value(_ path: String) -> ProjectPreferences { projects[ProjectPreferences.key(path)] ?? .init() }
    func save(_ value: ProjectPreferences, for path: String) {
        projects[ProjectPreferences.key(path)] = value
        UserDefaults.standard.set(try? JSONEncoder().encode(projects), forKey: "projectPreferences")
    }
}

struct ProjectPreferencesView: View {
    let directory: String
    @Environment(\.dismiss) private var dismiss
    @ViewState private var value = ProjectPreferences()
    @ObservedObject private var editors = ProjectEditorPreferences.shared
    private var validLinks: Bool { [value.localURL, value.stagingURL, value.repositoryURL].allSatisfy { $0.isEmpty || ProjectPreferences.link($0) != nil } }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Project preferences").font(.title2.bold())
            Text(directory).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            Form {
                Picker("Preferred agent", selection: $value.agent) {
                    Text("Use last choice").tag("")
                    ForEach(["Codex", "Claude", "Copilot"], id: \.self) { Text($0).tag($0) }
                }
                Picker("Editor", selection: $value.editorPath) {
                    Text("Use default editor").tag("")
                    ForEach(editors.choices) { Text($0.name).tag($0.path) }
                    if !value.editorPath.isEmpty && !editors.choices.contains(where: { $0.path == value.editorPath }) { Text("Unavailable editor").tag(value.editorPath) }
                }
                TextField("Local app URL", text: $value.localURL)
                TextField("Staging URL", text: $value.stagingURL)
                TextField("Repository URL", text: $value.repositoryURL)
                TextField("Run app command", text: $value.runCommand)
                TextField("Run tests command", text: $value.testCommand)
                TextField("Build command", text: $value.buildCommand)
                Text("Commands run only when you choose them and confirm. They run in this folder using your login shell.").font(.caption).foregroundStyle(.secondary)
                Text("Note to include with new handoffs").font(.headline)
                TextEditor(text: $value.note).frame(height: 90).border(.quaternary)
            }
            if !validLinks { Text("Project links must be full http:// or https:// URLs.").font(.caption).foregroundStyle(.orange) }
            HStack { Button("Cancel") { dismiss() }; Spacer(); Button("Save") { ProjectPreferencesStore.shared.save(value, for: directory); dismiss() }.buttonStyle(.borderedProminent).disabled(!validLinks) }
        }.padding(24).frame(width: 560).onAppear { editors.refresh(); value = ProjectPreferencesStore.shared.value(directory) }
    }
}

struct ProjectShortcutView: View {
    let directory: String
    @ObservedObject private var preferences = ProjectPreferencesStore.shared
    @ViewState private var settings = false
    @ViewState private var command: ProjectCommandRequest?
    private var value: ProjectPreferences { preferences.value(directory) }
    var body: some View {
        DisclosureGroup("Project shortcuts") {
            VStack(alignment: .leading, spacing: 8) {
                if let url = ProjectPreferences.link(value.localURL) { Link("Open local app", destination: url) }
                if let url = ProjectPreferences.link(value.stagingURL) { Link("Open staging", destination: url) }
                if let url = ProjectPreferences.link(value.repositoryURL) { Link("Open repository", destination: url) }
                action("Run app", value.runCommand); action("Run tests", value.testCommand); action("Build", value.buildCommand)
                if !value.note.isEmpty { Text(value.note).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                Button("Project preferences…") { settings = true }
            }.padding(.top, 6)
        }.font(.caption)
            .sheet(isPresented: $settings) { ProjectPreferencesView(directory: directory) }
            .sheet(item: $command) { ProjectCommandView(request: $0, directory: directory) }
    }
    @ViewBuilder private func action(_ title: String, _ text: String) -> some View {
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Button(title + "…") { command = .init(title: title, command: text) }
        }
    }
}
struct ProjectCommandRequest: Identifiable { let id = UUID(); let title: String; let command: String }
@MainActor final class ProjectCommandRunner: ObservableObject {
    @Published var output = ""
    @Published var running = false
    private var process: Process?
    private var processGroup: Int32?
    static var active: [Int32: Process] = [:]
    static func stopAll() { for (pid, process) in active where process.isRunning { kill(-pid, SIGTERM) } }
    func run(_ command: String, in directory: String) {
        guard !running else { return }
        let process = Process(), pipe = Pipe()
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("python/bin/python3").path
        let python = bundled.flatMap { FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil } ?? "/usr/bin/python3"
        process.executableURL = URL(fileURLWithPath: python)
        process.arguments = ["-c", "import os,sys; os.setpgid(0,0) if os.getpgrp()!=os.getpid() else None; os.execv('/bin/zsh',['zsh','-l','-c',sys.argv[1]])", command]
        process.environment = ProcessInfo.processInfo.environment.merging(["TERM": "dumb", "NO_COLOR": "1"]) { _, new in new }
        process.currentDirectoryURL = URL(fileURLWithPath: directory)
        process.standardInput = FileHandle.nullDevice; process.standardOutput = pipe; process.standardError = pipe
        self.process = process; output = ""; running = true
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.output = String((self.output + String(decoding: data, as: UTF8.self)).suffix(200_000))
            }
        }
        process.terminationHandler = { process in
            Task { @MainActor [weak self] in Self.active.removeValue(forKey: process.processIdentifier); self?.running = false; self?.output += "\nExited with status \(process.terminationStatus)" }
        }
        do { try process.run(); processGroup = process.processIdentifier; Self.active[process.processIdentifier] = process } catch { running = false; output = error.localizedDescription; pipe.fileHandleForReading.readabilityHandler = nil }
    }
    func stop() {
        guard let process, process.isRunning, let group = processGroup else { return }
        kill(-group, SIGTERM)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            if process.isRunning { kill(-group, SIGKILL) }
        }
    }
}
struct ProjectCommandView: View {
    let request: ProjectCommandRequest
    let directory: String
    @Environment(\.dismiss) private var dismiss
    @StateObject private var runner = ProjectCommandRunner()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(request.title).font(.title2.bold())
            Text(directory).font(.caption).textSelection(.enabled)
            Text(request.command).font(.system(.body, design: .monospaced)).textSelection(.enabled)
            Text("This runs your configured command and may change project files. It does not run automatically.").font(.caption).foregroundStyle(.secondary)
            Text("Command output · keeps the most recent 200,000 characters").font(.caption).foregroundStyle(.secondary)
            ScrollView { Text(runner.output).font(.system(size: 12, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(height: 260)
            HStack {
                Button("Close") { dismiss() }.disabled(runner.running)
                Spacer()
                if runner.running { ProgressView().controlSize(.small); Button("Stop") { runner.stop() } }
                else { Button("Run command") { runner.run(request.command, in: directory) }.buttonStyle(.borderedProminent) }
            }
        }.padding(24).frame(width: 650).interactiveDismissDisabled(runner.running)
    }
}
