import SwiftUI
import SessionCore

struct BulkGenerationRequest: Identifiable {
    let id = UUID()
    let summaries: Bool
    let sessions: [Session]
}

struct BulkGenerationView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let request: BulkGenerationRequest
    @ViewState private var running = false
    @ViewState private var started = false
    @ViewState private var stopRequested = false
    @ViewState private var statuses: [String: String] = [:]
    @ViewState private var drafts: [String: SavedWork] = [:]
    @ViewState private var saved: Set<String> = []
    @ViewState private var confirmClose = false
    private var unsaved: Bool { drafts.keys.contains { !saved.contains($0) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(request.summaries ? "Save work summaries" : "Generate handoffs").font(.title2.bold())
            Text("\(request.sessions.count) selected sessions · processed one at a time")
                .font(.callout).foregroundStyle(.secondary)
            Picker("Generate with", selection: $model.handoffAIProvider) {
                ForEach(model.handoffProviders, id: \.self) { Text($0).tag($0) }
            }.disabled(started)
            Text("Sends each session’s recorded history and notes to the selected AI CLI account and uses its allowance. Each session can take a minute or two. Active sessions are not interrupted.")
                .font(.caption).foregroundStyle(.secondary)
            Text(request.summaries ? "Generated summaries remain drafts here until you review and save them. Each saved summary becomes a separate library record." : "Handoffs are saved to their sessions. Existing manual edits are preserved; replacement drafts remain available for review in each session’s Handoff tab.")
                .font(.caption).foregroundStyle(.secondary)
            if running {
                HStack {
                    ProgressView().controlSize(.small)
                    Text(stopRequested ? "Finishing the current session, then stopping…" : "Generating… you can stop after the current session.").font(.caption)
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(request.sessions) { row in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(model.displayName(for: row)).font(.headline)
                            Text("\(row.provider) · \(row.project)").font(.caption).foregroundStyle(.secondary)
                            Text(statuses[row.id] ?? "Ready").font(.caption).textSelection(.enabled)
                            if let draft = drafts[row.id] {
                                DisclosureGroup(saved.contains(row.id) ? "Saved summary" : "Review and edit summary") {
                                    TextEditor(text: Binding(get: { drafts[row.id]?.text ?? "" }, set: { drafts[row.id]?.text = $0 }))
                                        .font(.system(size: 13)).frame(height: 180).border(.quaternary)
                                        .disabled(saved.contains(row.id))
                                }
                                Button(saved.contains(row.id) ? "Saved to library" : "Save to library") { save(row.id) }
                                    .disabled(running || saved.contains(row.id) || draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                        }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            HStack {
                Button(started ? "Done" : "Cancel") {
                    if unsaved { confirmClose = true } else { dismiss() }
                }.disabled(running)
                Spacer()
                if running {
                    Button("Stop after current") { stopRequested = true }.disabled(stopRequested)
                } else if !started {
                    Button(request.summaries ? "Generate summary drafts" : "Generate handoffs") { run() }
                        .buttonStyle(.borderedProminent).disabled(model.handoffProviders.isEmpty || request.sessions.isEmpty)
                } else if request.summaries && unsaved {
                    Button("Save all reviewed summaries") {
                        for row in request.sessions where drafts[row.id] != nil && !saved.contains(row.id) { save(row.id) }
                    }.buttonStyle(.borderedProminent)
                }
            }
        }.padding(24).frame(width: 640, height: 650).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .interactiveDismissDisabled()
            .confirmationDialog("Discard unsaved summary drafts? Saved records will remain in your library.", isPresented: $confirmClose) {
                Button("Discard unsaved drafts", role: .destructive) { dismiss() }
            }
            .onAppear {
                if !model.handoffProviders.contains(model.handoffAIProvider), let first = model.handoffProviders.first { model.handoffAIProvider = first }
            }
    }
    private func save(_ id: String) {
        guard var record = drafts[id], !saved.contains(id), !record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        record.updatedAt = Date()
        if model.saveWork(record) {
            saved.insert(id); statuses[id] = "Saved in Library → Saved work"
        } else { statuses[id] = model.workError ?? "Could not save summary. Try again." }
    }
    private func run() {
        running = true; started = true
        Task { @MainActor in
            defer { running = false }
            for row in request.sessions {
                if stopRequested { statuses[row.id] = "Not processed — stopped"; continue }
                guard !row.simulated, model.sessions.contains(where: { $0.id == row.id }) else {
                    statuses[row.id] = "Skipped — session is no longer available"; continue
                }
                guard !model.handoffGenerating.contains(row.id) else {
                    statuses[row.id] = "Skipped — a handoff is already generating"; continue
                }
                statuses[row.id] = "Reading history and generating…"
                if request.summaries {
                    do {
                        drafts[row.id] = try await model.generateWorkSummary(row)
                        statuses[row.id] = "Draft ready — review before saving"
                    } catch { statuses[row.id] = "Failed: " + error.localizedDescription }
                } else {
                    await model.generateHandoff(row)
                    if let error = model.handoffErrors[row.id] { statuses[row.id] = error }
                    else if model.handoffCandidates[row.id] != nil { statuses[row.id] = "Ready for review in Handoff — your edits were preserved" }
                    else if model.handoffs[row.id] != nil { statuses[row.id] = "Handoff saved — review it in the session’s Handoff tab" }
                    else { statuses[row.id] = "No handoff saved — session may have become unavailable" }
                }
            }
        }
    }
}
