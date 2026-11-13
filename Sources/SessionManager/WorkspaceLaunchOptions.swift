import SwiftUI
import SessionCore

struct WorkspaceLaunchOptions: View {
    let directory: String
    @Binding var isolated: Bool
    @Binding var allowShared: Bool
    @Binding var branch: String
    let destination: String
    @EnvironmentObject private var model: AppModel
    @ViewState private var repository = false
    private var shared: Bool { model.hasOpenSession(in: directory) }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if shared {
                Label("Another agent is open in this folder.", systemImage: "exclamationmark.triangle").font(.callout).foregroundStyle(.orange)
            }
            if repository {
                Toggle("Create an isolated workspace", isOn: $isolated)
                if isolated {
                    TextField("New branch", text: $branch).textFieldStyle(.roundedBorder)
                    Text("Folder: " + destination).font(.caption).textSelection(.enabled)
                    Text("Starts from the current commit. Uncommitted changes and untracked files are not copied.").font(.caption).foregroundStyle(.secondary)
                }
            }
            if shared && !isolated {
                Toggle("Use this folder · both agents can edit the same files", isOn: $allowShared).font(.caption)
            }
        }.task(id: directory) {
            isolated = false; allowShared = false
            let context = try? await RepositoryContext.read(at: directory)
            if !Task.isCancelled { repository = context != nil }
        }
    }
}

extension AppModel {
    func hasOpenSession(in directory: String) -> Bool {
        let key = ProjectPreferences.key(directory)
        return EmbeddedTerminals.shared.running.contains { !$0.isShell && ProjectPreferences.key($0.directory) == key }
            || sessions.contains { !$0.simulated && [.working, .idle, .needsInput].contains($0.state) && ProjectPreferences.key($0.cwd) == key }
    }
}
