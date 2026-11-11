import SwiftUI
import SessionCore

/// An agent-neutral attention summary. The terminal remains the place to
/// answer every request type; status alone is never treated as an approval payload.
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
        VStack(alignment: .leading, spacing: 16) {
            if let row = waiting.first {
                HStack(alignment: .top, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Needs you · \(waiting.count)", systemImage: "hand.raised.fill")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(SessionState.needsInput.color)
                        Text(title(row)).font(.system(size: 23, weight: .semibold, design: .rounded))
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                        Text("\(row.project) · \(row.provider)").font(.callout).foregroundStyle(.secondary).lineLimit(1)
                        Text("A question, approval, or other input is waiting in this session.")
                            .font(.callout).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    VStack(alignment: .trailing, spacing: 10) {
                        Button { resume(row) } label: {
                            Label(navigating ? "Locating…" : "Go to terminal", systemImage: "arrow.up.forward")
                        }.buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                            .disabled(navigating || row.simulated)
                        Button("View session") { inspect(row) }.buttonStyle(.plain).foregroundStyle(HuddleStyle.accent)
                    }.padding(.top, 24)
                }
                if waiting.count > 1 {
                    Button("View all \(waiting.count) sessions needing input", action: showAll)
                        .buttonStyle(.plain).font(.callout.weight(.medium)).foregroundStyle(SessionState.needsInput.color)
                }
            } else {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 24, weight: .light)).foregroundStyle(SessionState.idle.color)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Nothing needs your attention").font(.system(size: 17, weight: .semibold))
                        Text("No sessions in this view are reporting a request for input.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
            Divider().opacity(0.6)
            HStack(spacing: 28) {
                metric(.working)
                metric(.idle)
                Spacer()
                Text("\(sessions.count) active \(sessions.count == 1 ? "session" : "sessions")")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(waiting.isEmpty ? HuddleStyle.panel : SessionState.needsInput.color.opacity(0.065), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(waiting.isEmpty ? HuddleStyle.border.opacity(0.5) : SessionState.needsInput.color.opacity(0.3)))
    }
    private func metric(_ state: SessionState) -> some View {
        HStack(spacing: 8) {
            Text("\(sessions.filter { $0.state == state }.count)")
                .font(.system(size: 22, weight: .medium, design: .rounded)).monospacedDigit()
            Label(state.title, systemImage: state.symbol).font(.caption).foregroundStyle(.secondary)
        }
    }
}
