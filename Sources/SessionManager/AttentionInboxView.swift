import SwiftUI
import SessionCore

@MainActor final class AttentionInboxStore: ObservableObject {
    static let shared = AttentionInboxStore()
    @Published var entries: [InboxEntry] = (UserDefaults.standard.data(forKey: "attentionInbox").flatMap { try? JSONDecoder().decode([InboxEntry].self, from: $0) }) ?? [] {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(entries), forKey: "attentionInbox") }
    }
    private var lastStates: [String: SessionState] = (UserDefaults.standard.data(forKey: "inboxLastStates").flatMap { try? JSONDecoder().decode([String: SessionState].self, from: $0) }) ?? [:]
    func observe(previous: [Session], current: [Session]) {
        let before = current.map { row -> Session in
            var old = previous.first { $0.id == row.id } ?? row
            if old.state == .disconnected, let state = lastStates[row.id] { old.state = state }
            return old
        }
        let updated = AttentionInbox.updating(entries, previous: before, current: current)
        if entries != updated { entries = updated }
        for row in current where !row.simulated && row.state != .disconnected { lastStates[row.id] = row.state }
        lastStates = lastStates.filter { id, _ in current.contains { $0.id == id } }
        UserDefaults.standard.set(try? JSONEncoder().encode(lastStates), forKey: "inboxLastStates")
    }
    func read(_ id: String) { entries = AttentionInbox.reading(entries, sessionID: id) }
    func exited(_ row: Session) {
        let entry = InboxEntry(session: row, kind: "exit")
        entries.removeAll { $0.id == entry.id }; entries.insert(entry, at: 0); entries = Array(entries.prefix(100))
    }
}

struct AttentionInboxButton: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var inbox = AttentionInboxStore.shared
    @ViewState private var showing = false
    private var waiting: [Session] { model.sessions.filter { $0.state == .needsInput && !$0.simulated } }
    private var count: Int { waiting.count + inbox.entries.filter { !$0.read }.count }
    var body: some View {
        Button { showing.toggle() } label: {
            Label(count > 0 ? "Inbox \(count)" : "Inbox", systemImage: count > 0 ? "tray.fill" : "tray")
        }.popover(isPresented: $showing) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Attention inbox").font(.headline); Spacer()
                    Button("Clear read") { inbox.entries.removeAll { $0.read } }.disabled(!inbox.entries.contains { $0.read })
                }
                if inbox.entries.contains(where: { !$0.read }) {
                    Button("Mark results read") { inbox.entries = inbox.entries.map { var entry = $0; entry.read = true; return entry } }.font(.caption)
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if waiting.isEmpty && inbox.entries.isEmpty { Text("You’re all caught up.").foregroundStyle(.secondary) }
                        ForEach(waiting) { row in
                            Button { model.showSession(row.id); model.resume(row); showing = false } label: {
                                VStack(alignment: .leading) {
                                    Label("Needs your response", systemImage: "hand.raised.fill").foregroundStyle(.orange)
                                    Text(model.displayName(for: row)).lineLimit(2)
                                    Text(row.attention?.title ?? "Open the session to respond").font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                        ForEach(inbox.entries) { entry in
                            Button {
                                inbox.read(entry.sessionID)
                                if model.sessions.contains(where: { $0.id == entry.sessionID }) { model.showSession(entry.sessionID) }
                                if let row = model.sessions.first(where: { $0.id == entry.sessionID }), model.ownedSessionIDs.contains(row.id) { model.resume(row) }
                                showing = false
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Label(entry.kind == "exit" ? "Agent exited unexpectedly" : "Result to review", systemImage: entry.read ? "circle" : "circle.fill")
                                        .font(.caption).foregroundStyle(entry.read ? Color.secondary : HuddleStyle.accent)
                                    Text(entry.title).lineLimit(2)
                                    Text(entry.date, style: .relative).font(.caption2).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }.frame(maxHeight: 380)
                Text("Opening a result marks it read. Requests stay pending until the agent reports them resolved.").font(.caption).foregroundStyle(.secondary)
            }.padding(16).frame(width: 350)
        }
    }
}
