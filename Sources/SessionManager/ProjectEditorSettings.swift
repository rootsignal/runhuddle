import AppKit
import SwiftUI
import UniformTypeIdentifiers
import SessionCore

@MainActor final class ProjectEditorPreferences: ObservableObject {
    static let shared = ProjectEditorPreferences()
    @Published var installed: [ProjectEditor] = []
    @Published var selectedPath: String = UserDefaults.standard.string(forKey: "projectEditorPath") ?? "" {
        didSet { UserDefaults.standard.set(selectedPath, forKey: "projectEditorPath") }
    }
    @Published var error: String?
    var selected: ProjectEditor? { ProjectEditor.preferred(path: selectedPath, installed: installed) }
    var choices: [ProjectEditor] {
        guard let selected, !installed.contains(selected) else { return installed }
        return installed + [selected]
    }
    init() { refresh() }
    func refresh() {
        installed = ProjectEditor.discover(in: [URL(fileURLWithPath: "/Applications"), FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications")])
    }
    func choose() {
        let panel = NSOpenPanel()
        panel.title = "Choose your project editor"
        panel.allowedContentTypes = [.applicationBundle]
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        panel.canChooseDirectories = false; panel.canChooseFiles = true; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard let app = ProjectEditor(application: url) else { error = "Choose an installed application."; return }
        selectedPath = app.path; error = nil
    }
    func openFile(path: String, project: String, completion: @escaping (String?) -> Void) {
        let editor = ProjectPreferencesStore.shared.value(project).editorPath
        guard let selected = editor.isEmpty ? selected : ProjectEditor(application: URL(fileURLWithPath: editor)) else { completion("Choose an installed project editor in Settings."); return }
        guard FileManager.default.fileExists(atPath: path) else { completion("The file no longer exists."); return }
        NSWorkspace.shared.open([URL(fileURLWithPath: path)], withApplicationAt: URL(fileURLWithPath: selected.path), configuration: .init()) { _, error in
            DispatchQueue.main.async { completion(error?.localizedDescription) }
        }
    }
    func editor(for directory: String) -> ProjectEditor? {
        let path = ProjectPreferencesStore.shared.value(directory).editorPath
        return path.isEmpty ? selected : ProjectEditor(application: URL(fileURLWithPath: path))
    }
    func open(directory: String, completion: @escaping (String?) -> Void) {
        guard let editor = editor(for: directory) else { completion("Choose an installed editor in Settings → General."); return }
        var isDirectory: ObjCBool = false
        guard !directory.isEmpty, FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory), isDirectory.boolValue else {
            completion("This session’s project folder is no longer available."); return
        }
        NSWorkspace.shared.open([URL(fileURLWithPath: directory)], withApplicationAt: URL(fileURLWithPath: editor.path), configuration: .init()) { _, error in
            DispatchQueue.main.async { completion(error?.localizedDescription) }
        }
    }
}

struct ProjectEditorSettings: View {
    @ObservedObject private var editors = ProjectEditorPreferences.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Project editor").font(.headline)
            Picker("Open projects with", selection: $editors.selectedPath) {
                Text(editors.selectedPath.isEmpty ? "Automatic · " + (editors.selected?.name ?? "No editor found") : "Automatic").tag("")
                ForEach(editors.choices) { Text($0.name).tag($0.path) }
                if !editors.selectedPath.isEmpty && editors.selected == nil {
                    Text("Unavailable · " + URL(fileURLWithPath: editors.selectedPath).deletingPathExtension().lastPathComponent).tag(editors.selectedPath)
                }
            }
            HStack {
                Button("Choose another app…") { editors.choose() }
                Button("Check installed editors") { editors.refresh() }
            }
            Text("Opens the selected session’s working folder. Automatic prefers VS Code when installed.").font(.caption).foregroundStyle(.secondary)
            if let error = editors.error { Text(error).font(.caption).foregroundStyle(.orange) }
        }.onAppear { editors.refresh() }
    }
}

struct OpenProjectEditorButton: View {
    let directory: String
    var disabled = false
    @ObservedObject private var editors = ProjectEditorPreferences.shared
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var projectPreferences = ProjectPreferencesStore.shared
    var body: some View {
        Button(editors.editor(for: directory).map { "Open in " + $0.name } ?? "Choose project editor…") {
            if editors.editor(for: directory) == nil {
                model.settingsTab = "general"; model.openSettingsWindow?()
            } else {
                editors.open(directory: directory) { if let error = $0 { model.error = error } }
            }
        }.disabled(disabled || directory.isEmpty)
    }
}
