import SwiftUI
import SessionCore

/// Stable-height status strip shared by the overview and detail layouts.
/// All response types remain in the agent's terminal.
struct NowAttentionPanel: View {
    let sessions: [Session]
    let title: (Session) -> String
    let navigating: Bool
    let inspect: (Session) -> Void
    let resume: (Session) -> Void
    let showAll: () -> Void

    private var waiting: [Session] {
        sessions.filter { $0.state == .needsInput }.sorted {
            $0.updated == $1.updated ? $0.id < $1.id : $0.updated < $1.updated
        }
    }
    var body: some View {
        HStack(spacing: 16) {
            if let row = waiting.first {
                Button(action: waiting.count > 1 ? showAll : { inspect(row) }) {
                    Label("\(waiting.count) needs you", systemImage: "hand.raised.fill")
                        .font(.system(size: 12, weight: .semibold))
                }.buttonStyle(.plain).foregroundStyle(SessionState.needsInput.color)
                    .help("Show sessions needing input")
                Text(title(row)).font(.callout).lineLimit(1).truncationMode(.tail)
                    .foregroundStyle(.secondary).help(title(row))
                Spacer(minLength: 0)
                Button { resume(row) } label: {
                    Text(navigating ? "Locating…" : "Go to terminal")
                }.disabled(navigating || row.simulated)
                    .buttonStyle(.borderedProminent).tint(HuddleStyle.action)
            } else {
                Label("No input needed", systemImage: "checkmark.circle")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                    .help("No sessions in this view are reporting a request for input.")
                Spacer(minLength: 0)
            }
            metric(.working)
            metric(.idle)
        }
        .padding(.horizontal, 14).frame(height: 50)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(waiting.isEmpty ? HuddleStyle.panel : SessionState.needsInput.color.opacity(0.065), in: RoundedRectangle(cornerRadius: 9))
    }
    private func metric(_ state: SessionState) -> some View {
        HStack(spacing: 5) {
            Text("\(sessions.filter { $0.state == state }.count)").monospacedDigit()
            Text(state.title)
        }.font(.system(size: 12)).foregroundStyle(.secondary).fixedSize()
    }
}
