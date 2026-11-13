import SwiftUI
import SessionCore

struct SessionChainSummary: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    private var children: [Session] {
        model.sessions.filter { model.continuations[$0.id]?.sourceID == row.id }
            .sorted { (model.continuations[$0.id]?.createdAt ?? 0) < (model.continuations[$1.id]?.createdAt ?? 0) }
    }
    var body: some View {
        if model.continuations[row.id] != nil || !children.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                if let parent = model.continuations[row.id] {
                    if let source = model.sessions.first(where: { $0.id == parent.sourceID }) {
                        link(parent.sourceLabel, session: source)
                    } else {
                        Label("\(parent.sourceLabel) \(parent.sourceTitle) · history unavailable", systemImage: "arrow.triangle.branch")
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(children) { child in link(model.continuations[child.id]?.relationship == "reviewed" ? "Reviewed in" : model.continuations[child.id]?.relationship == "branched" ? "Branched into" : "Continued in", session: child) }
                let earlier = model.earlierSessions(row)
                if !earlier.isEmpty {
                    DisclosureGroup("\(earlier.count) earlier \(earlier.count == 1 ? "session" : "sessions")") {
                        ForEach(earlier) { previous in
                            link((previous.state == .idle ? "Idle · still open" : previous.state.title) + " ·", session: previous)
                        }
                        let closed = earlier.filter { $0.state == .saved && !model.ownedSessionIDs.contains($0.id) }
                        let open = earlier.filter { model.ownedSessionIDs.contains($0.id) || [.idle, .working, .needsInput].contains($0.state) }
                        Button(closed.isEmpty ? "Archive closed sessions…" : "Archive \(closed.count) closed \(closed.count == 1 ? "session" : "sessions")…") {
                            Task { await model.prepareBulkCleanup("archive", rows: closed) }
                        }
                        .disabled(model.cleaning || closed.isEmpty)
                        .help("Review closed earlier sessions for archiving. Their history is retained.")
                        if !open.isEmpty {
                            Text("\(open.count) earlier \(open.count == 1 ? "session is" : "sessions are") still open. End open sessions before archiving. In RunHuddle, select the session and choose … → End session; otherwise close it in its original terminal.")
                                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }.font(.caption).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func link(_ prefix: String, session: Session) -> some View {
        Button { model.showSession(session.id) } label: {
            Label(prefix + " " + model.displayName(for: session), systemImage: "arrow.triangle.branch")
                .lineLimit(2).multilineTextAlignment(.leading)
        }.buttonStyle(.plain).foregroundStyle(HuddleStyle.accent)
    }
}
