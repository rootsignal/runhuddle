import SwiftUI
import SessionCore

struct ReplySubmission: Codable, Identifiable {
    var id: String
    var text: String
    var status: String
    var baseline: [String]
    var observedMessageID: String?
    var channelMessageID: String?
}
struct InlineReplyRecord: Codable {
    var imagePaths: [String]?
    var wireText: String { LocalImageReference.prompt(text: text, paths: imagePaths ?? []) }
    var submissions: [ReplySubmission]?
    var text = ""
    var status = "draft"
    var message = ""
}
struct InlineReplyPayload: Encodable {
    let action: String
    let provider: String
    let sessionID: String
    let executable: String
    let text: String
    var resume: Bool? = nil
}
struct InlineReplyResult: Decodable {
    let outcome: String
    let message: String
    var messageID: String? = nil
    var receivedIDs: [String]? = nil
}

struct InlineReplyComposer: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    @ViewState private var installingCopilot = false
    @ViewState private var copilotSetupMessage: String?
    @ViewState private var showClaudeLaunch = false
    @ViewState private var showCopilotLaunch = false
    @ViewState private var capability: InlineReplyResult?
    @ViewState private var checkID = UUID()
    @ViewState private var confirmChecked = false
    @ViewState private var pasteNotice = false
    @ViewState private var editorWidth: CGFloat = 340
    private var editorHeight: CGFloat {
        let columns = max(12, Int((editorWidth - 24) / 7))
        let lines = record.text.split(separator: "\n", omittingEmptySubsequences: false).reduce(0) { $0 + max(1, ($1.count + columns - 1) / columns) }
        return min(110, max(38, CGFloat(lines) * 17 + 14))
    }
    private var record: InlineReplyRecord { model.replies[row.id] ?? InlineReplyRecord() }
    private var sending: Bool { model.replySending.contains(row.id) || record.status == "sending" }
    private var uncertain: Bool { record.status == "uncertain" }
    private var availableState: Bool { ["Codex", "Claude", "Copilot"].contains(row.provider) && !row.simulated && [.idle, .working].contains(row.state) }
    private var canSend: Bool {
        availableState && capability?.outcome == "ready" && !sending && !uncertain &&
        !record.wireText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && record.wireText.utf8.count <= 32000
    }
    private var reason: String {
        if !["Codex", "Claude", "Copilot"].contains(row.provider) { return "Reply in \(row.provider)’s terminal. Inline follow-ups support Codex and connected Claude sessions." }
        if row.state == .needsInput { return "Answer this question or approval in the terminal. A follow-up message won’t resolve that dialog." }
        if !availableState { return "Open this session in \(row.provider) to send a follow-up." }
        return capability?.message ?? "Checking \(row.provider) connection…"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack {
                Label("Follow-up", systemImage: "bubble.left.and.text.bubble.right").font(.subheadline.weight(.semibold))
                Spacer()
                if ["Codex", "Claude", "Copilot"].contains(row.provider) {
                    Button { capability = nil; checkID = UUID() } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.plain).help("Check reply connection").accessibilityLabel("Check reply connection")
                        .disabled(sending)
                }
            }
            if row.provider == "Copilot" && capability?.outcome == "setupRequired" {
                Text("Reconnect this conversation to send replies here. RunHuddle will restart idle Copilot with extension support.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Reconnect with replies…") { showCopilotLaunch = true }.buttonStyle(.bordered)
            }
            if row.provider == "Claude" && capability?.outcome == "setupRequired" {
                Text("Replies require Claude to be launched with RunHuddle’s connection. Sessions opened elsewhere can still be viewed here.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Connect Claude replies…") { showClaudeLaunch = true }.buttonStyle(.bordered)
            }
            if (availableState && capability?.outcome == "ready") || !record.wireText.isEmpty || sending || uncertain {
                if let paths = record.imagePaths, !paths.isEmpty {
                    ScrollView { VStack(spacing: 6) {
                        ForEach(paths, id: \.self) { path in
                            LocalImagePreview(path: path, remove: {
                                var draft = record; draft.imagePaths?.removeAll { $0 == path }
                                _ = model.saveReply(draft, for: row.id)
                            }).disabled(sending || uncertain)
                        }
                    } }.frame(height: min(CGFloat(paths.count) * 76, 152))
                }
                ReplyTextEditor(text: Binding(get: { record.text }, set: { text in
                    var draft = record; draft.text = text
                    if !uncertain && !sending { draft.status = "draft"; draft.message = "" }
                    _ = model.saveReply(draft, for: row.id)
                }), imagePathsPasted: { paths in
                    guard !sending && !uncertain else { return }
                    var draft = record
                    var unique = draft.imagePaths ?? []
                    for path in paths where !unique.contains(path) { unique.append(path) }
                    draft.imagePaths = unique; draft.status = "draft"; draft.message = ""
                    _ = model.saveReply(draft, for: row.id)
                    pasteNotice = false
                }, imageRejected: { pasteNotice = true }, sendMessage: { if canSend { Task { await model.sendReply(row) } } }).frame(height: editorHeight).padding(7)
                    .background(GeometryReader { geometry in Color.clear.onAppear { editorWidth = geometry.size.width }.onChange(of: geometry.size.width) { _, width in editorWidth = width } })
                    .background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(HuddleStyle.border))
                    .accessibilityLabel("Follow-up message to \(model.displayName(for: row))")
                    .disabled(sending || uncertain)
                if pasteNotice {
                    HStack(alignment: .top) {
                        Text("Paste an image file or its local path to add a preview. Raw clipboard images still need the terminal.").font(.caption).foregroundStyle(.orange)
                        Button { pasteNotice = false } label: { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel("Dismiss image notice")
                    }
                }
                if record.wireText.utf8.count > 32000 { Text("Message is too long. Keep it under 32 KB.").font(.caption).foregroundStyle(.orange) }
                if !record.message.isEmpty && record.status != "queued" {
                    Label(record.message, systemImage: record.status == "queued" ? "checkmark.circle" : uncertain ? "exclamationmark.triangle" : "info.circle")
                        .font(.caption).foregroundStyle(uncertain ? Color.orange : .secondary)
                }
                HStack(alignment: .top) {
                    Text(availableState && capability?.outcome == "ready" ? "Return to send · Shift-Return for a new line" : reason)
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    Button { Task { await model.sendReply(row) } } label: {
                        if sending { ProgressView().controlSize(.small) }
                        else { Label("Send", systemImage: "paperplane.fill") }
                    }.buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                        .keyboardShortcut(.return, modifiers: .command).disabled(!canSend)
                        .help("Queue this text in the existing \(row.provider) session using its model and permissions")
                }
                if uncertain {
                    HStack {
                        Button("Go to terminal") { model.resume(row) }.disabled(model.navigatingTerminal)
                        Button("I’ve checked delivery…") { confirmChecked = true }
                    }.font(.caption)
                }
            } else if capability?.outcome != "setupRequired" {
                Text(reason).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.top, 8).background(HuddleStyle.panel)
        .task(id: row.id + row.state.rawValue + checkID.uuidString) {
            capability = nil
            if !sending && !uncertain {
                let references = LocalImageReference.extract(from: record.text)
                if !references.isEmpty {
                    var draft = record
                    var paths = draft.imagePaths ?? []
                    for reference in references where !paths.contains(reference.path) { paths.append(reference.path) }
                    draft.imagePaths = paths
                    draft.text = references.reduce(draft.text) { $0.replacingOccurrences(of: $1.source, with: "") }
                        .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'")))
                    _ = model.saveReply(draft, for: row.id)
                }
            }
            guard availableState else { return }
            while !Task.isCancelled {
                let result = await model.checkReply(row)
                guard !Task.isCancelled else { return }
                capability = result
                guard row.provider != "Codex" else { return }
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
            }
        }
        .sheet(isPresented: $showCopilotLaunch) { CopilotLaunchView(row: row) }
        .sheet(isPresented: $showClaudeLaunch) { ClaudeLaunchView(row: row) }
        .confirmationDialog("Have you checked whether \(row.provider) received this message?", isPresented: $confirmChecked) {
            Button("It was received — clear draft") {
                _ = model.saveReply(InlineReplyRecord(), for: row.id)
            }
            Button("It was not received — allow sending again") {
                var draft = record; draft.status = "draft"; draft.message = ""
                _ = model.saveReply(draft, for: row.id)
                checkID = UUID()
            }
        } message: { Text("Sending again could duplicate the request if \(row.provider) already received it.") }
    }
}

// Native text input lets image paste fail visibly rather than silently losing an attachment.
private struct ReplyTextEditor: NSViewRepresentable {
    @Binding var text: String
    var imagePathsPasted: ([String]) -> Void
    var imageRejected: () -> Void
    var sendMessage: () -> Void
    @Environment(\.isEnabled) private var enabled
    class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ReplyTextEditor
        init(_ parent: ReplyTextEditor) { self.parent = parent }
        func textDidChange(_ notification: Notification) {
            if let editor = notification.object as? NSTextView { parent.text = editor.string }
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView(); scroll.hasVerticalScroller = true; scroll.drawsBackground = false
        let editor = ReplyInputTextView(); editor.allowsUndo = true; editor.isRichText = false; editor.drawsBackground = false
        editor.font = .systemFont(ofSize: 13); editor.textColor = .labelColor
        editor.isVerticallyResizable = true; editor.isHorizontallyResizable = false
        editor.autoresizingMask = [.width]; editor.textContainer?.widthTracksTextView = true
        editor.delegate = context.coordinator; editor.imagePathsPasted = imagePathsPasted; editor.imageRejected = imageRejected; editor.sendMessage = sendMessage
        editor.setAccessibilityLabel("Follow-up message")
        scroll.documentView = editor
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let editor = scroll.documentView as? ReplyInputTextView else { return }
        if editor.string != text { editor.string = text }
        editor.isEditable = enabled; editor.imagePathsPasted = imagePathsPasted; editor.imageRejected = imageRejected; editor.sendMessage = sendMessage
    }
}
