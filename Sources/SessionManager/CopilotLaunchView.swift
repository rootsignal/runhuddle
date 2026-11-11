import SwiftUI
import SessionCore

struct CopilotLaunchView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let row: Session
    @ViewState private var busy = false
    @ViewState private var failure: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("Reconnect Copilot", systemImage: "arrow.triangle.2.circlepath").font(.title2.bold())
            Text(model.displayName(for: row)).font(.headline)
            Text("RunHuddle will close the idle Copilot process and resume this same conversation in your preferred terminal with replies enabled. Your conversation history is preserved.")
            Text("Replies use Copilot’s experimental extension support. Your model and approval settings still apply; answer approvals in the terminal.")
                .foregroundStyle(.secondary)
            if let failure { Text(failure).foregroundStyle(.orange) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(busy)
                Spacer()
                if busy { ProgressView().controlSize(.small) }
                Button("Reconnect with replies") {
                    busy = true
                    Task {
                        failure = await model.launchConnectedCopilot(sessionID: row.sessionID, directory: row.cwd, resume: true)
                        busy = false
                        if failure == nil { dismiss() }
                    }
                }.buttonStyle(.borderedProminent).disabled(busy || model.navigatingTerminal)
            }
        }.fixedSize(horizontal: false, vertical: true).padding(24).frame(width: 500)
            .background(HuddleStyle.canvas).tint(HuddleStyle.accent)
    }
}
