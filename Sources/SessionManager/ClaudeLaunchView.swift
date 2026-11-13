import SwiftUI
import SessionCore

struct ClaudeLaunchView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let row: Session?
    @ViewState private var directory: String
    @ViewState private var resumeExisting: Bool
    @ViewState private var busy = false
    @ViewState private var failure: String?
    init(row: Session? = nil) {
        self.row = row
        _directory = ViewState(initialValue: row?.cwd ?? "")
        _resumeExisting = ViewState(initialValue: row != nil)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Claude with RunHuddle replies", systemImage: "bubble.left.and.text.bubble.right")
                .font(.title2.bold())
            Text("Launch Claude in your preferred terminal, then send follow-ups from RunHuddle’s Activity tab.")
                .foregroundStyle(.secondary)
            if let row {
                Picker("Conversation", selection: $resumeExisting) {
                    Text("Resume this conversation").tag(true)
                    Text("Start a new conversation").tag(false)
                }.pickerStyle(.radioGroup)
                if resumeExisting {
                    Text("First exit \(model.displayName(for: row)) in Claude’s terminal with /exit. Its conversation is saved. Then choose Resume with replies below.")
                        .font(.callout).fixedSize(horizontal: false, vertical: true)
                    Button("Open session") { model.resume(row) }.disabled(model.navigatingTerminal)
                }
            }
            HStack {
                TextField("Project folder", text: $directory).textFieldStyle(.roundedBorder)
                Button("Choose…") {
                    let panel = NSOpenPanel()
                    panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
                    if panel.runModal() == .OK, let url = panel.url { directory = url.path }
                }
            }.disabled(resumeExisting)
            VStack(alignment: .leading, spacing: 8) {
                Label("Experimental Claude connection", systemImage: "info.circle").font(.headline)
                Text("Claude will ask you to allow RunHuddle’s development channel in the terminal. Accept it to enable replies. Your Claude model and permission settings still apply; tool approvals stay in the terminal.")
                Text("Sessions started normally outside RunHuddle remain view-only here. Use this launch option whenever you want replies.")
            }.font(.callout).foregroundStyle(.secondary).padding(14)
                .background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 10))
            if let failure { Text(failure).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(busy)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button(resumeExisting ? "Resume with replies" : "Start with replies") {
                    busy = true; failure = nil
                    Task {
                        let sid = resumeExisting ? row!.sessionID : UUID().uuidString.lowercased()
                        failure = await model.launchConnectedClaude(sessionID: sid, directory: (directory as NSString).expandingTildeInPath, resume: resumeExisting)
                        busy = false
                        if failure == nil { dismiss() }
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(busy || model.navigatingTerminal || directory.isEmpty)
            }
        }.padding(24).frame(width: 530).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
    }
}
