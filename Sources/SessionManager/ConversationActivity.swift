import SwiftUI
import SessionCore

struct ConversationActivity: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    @ViewState private var following = true
    @ViewState private var jumpToLatest = 0
    private var messages: [ConversationMessage] {
        guard let context = model.contexts[row.id] else { return [] }
        if let messages = context.messages { return messages }
        return [context.latestRequest.map { ConversationMessage(id: "request", role: "user", text: $0) },
                context.latestResponse.map { ConversationMessage(id: "response", role: "assistant", text: $0) }].compactMap { $0 }
    }
    private var pending: [ReplySubmission] {
        (model.replies[row.id]?.submissions ?? []).filter { entry in
            entry.observedMessageID == nil && !messages.contains { $0.role == "user" && $0.text == entry.text && !entry.baseline.contains($0.id) }
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Label("Recent conversation", systemImage: "text.bubble")
                    .font(.caption.weight(.medium)).foregroundStyle(.secondary)
                Spacer()
                if let context = model.contexts[row.id] { Text(context.updated, style: .relative).font(.caption2).foregroundStyle(.secondary) }
                Button { Task { await model.appendHistory(row) } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(QuietIconButtonStyle()).help("Refresh conversation").accessibilityLabel("Refresh conversation")
                    .disabled(model.historyLoading.contains(row.id))
            }.padding(.bottom, 6)
            ZStack(alignment: .bottomTrailing) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("Recent recorded messages · older activity and tool output may be omitted")
                                .font(.caption2).foregroundStyle(.secondary)
                            if let failure = model.historyErrors[row.id] { Text(failure).font(.caption).foregroundStyle(.orange) }
                            if messages.isEmpty {
                                Text(model.historyLoading.contains(row.id) ? "Loading conversation…" : "No recorded messages yet.").foregroundStyle(.secondary)
                            }
                            ForEach(messages) { message in
                                conversationMessage(message.text, user: message.role == "user", status: nil)
                                    .id(message.id)
                            }
                            ForEach(pending) { entry in
                                conversationMessage(entry.text, user: true, status: entry.status == "queued" ? "Queued · waiting for \(row.provider)" : entry.status == "forwarded" ? "Forwarded · awaiting Claude receipt" : entry.status == "received" ? "Received by Claude" : entry.status == "sending" ? "Sending…" : entry.status == "uncertain" ? "Delivery unconfirmed · check terminal" : "Not sent")
                            }
                            ConversationScrollFollower(following: $following, sessionID: row.id, jump: jumpToLatest)
                                .frame(height: 1)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 10).padding(.trailing, 8)
                    }
                    if !following {
                        Button { jumpToLatest += 1 } label: { Label("Latest", systemImage: "arrow.down") }
                            .buttonStyle(.borderedProminent).tint(HuddleStyle.action).padding(8)
                    }
            }

            if row.state == .working {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("\(row.provider) is working…").font(.caption.weight(.medium))
                    Spacer()
                }.foregroundStyle(.secondary).padding(.vertical, 10)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(row.provider) is working")
            }
            if row.state == .needsInput {
                AttentionRequestCard(row: row, review: { model.resume(row) }, navigating: model.navigatingTerminal)
                    .padding(.top, 8)
            } else {
                InlineReplyComposer(row: row)
            }
        }
        .task(id: row.id) {
            while !Task.isCancelled {
                await model.appendHistory(row)
                do { try await Task.sleep(for: .seconds(4)) } catch { break }
            }
        }
    }
    private func conversationMessage(_ text: String, user: Bool, status: String?) -> some View {
        let references = user ? LocalImageReference.extract(from: text) : []
        return VStack(alignment: .leading, spacing: 7) {
            HStack {
                Label(user ? "You" : row.provider, systemImage: user ? "person.crop.circle" : "sparkles")
                    .font(.caption.weight(.semibold)).foregroundStyle(user ? HuddleStyle.accent : .secondary)
                if let status { Text(status).font(.caption2).foregroundStyle(.secondary) }
            }
            Text(HuddleStyle.inline(LocalImageReference.displayText(text, references: references))).font(.system(size: 13)).lineSpacing(4).textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            ForEach(references) { reference in LocalImagePreview(path: reference.path) }
        }.padding(.leading, 12)
            .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(user ? HuddleStyle.accent.opacity(0.6) : HuddleStyle.border).frame(width: 2) }
    }
}
