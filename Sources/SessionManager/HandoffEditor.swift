import SwiftUI
import SessionCore

struct HandoffEditor: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    let startFresh: () -> Void
    private var generating: Bool { model.handoffGenerating.contains(row.id) }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("AI handoff").font(.headline)
                Text("Summarize the objective, decisions, completed work, and next steps for a fresh session.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    Picker("Generate with", selection: $model.handoffAIProvider) {
                        ForEach(model.handoffProviders, id: \.self) { Text($0).tag($0) }
                    }.disabled(generating)
                    Button(generating ? "Generating…" : model.handoffs[row.id] == nil ? "Generate handoff" : "Update handoff") {
                        Task { await model.generateHandoff(row) }
                    }.disabled(generating || row.simulated || model.handoffProviders.isEmpty)
                    if generating { ProgressView().controlSize(.small) }
                }
                Text("Sends recorded history and your notes to the selected AI using its signed-in CLI account. Uses your plan’s allowance. Your active session is not interrupted.")
                    .font(.caption).foregroundStyle(.secondary)
                if generating {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.handoffProgress[row.id] ?? "Preparing handoff…").font(.headline)
                        Text("AI generation can take a minute or two, especially for longer sessions. You can keep browsing RunHuddle; the handoff will be ready here when it finishes.")
                            .font(.callout).foregroundStyle(.secondary)
                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
                if let failure = model.handoffErrors[row.id] { Text(failure).font(.callout).foregroundStyle(.orange).textSelection(.enabled) }
                if let generated = model.handoffs[row.id] {
                    Text("Generated with \(generated.provider) · \(generated.generatedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                    if generated.hasEdits(model.draft(for: row)) { Text("Edited by you · changes saved automatically").font(.caption).foregroundStyle(.secondary) }
                    if model.handoffIsStale(row) {
                        Label("New activity or notes since this handoff", systemImage: "clock.arrow.circlepath")
                            .font(.caption).foregroundStyle(.orange)
                    }
                } else if !generating {
                    Text("No handoff yet. Click Generate handoff to create an AI summary.").foregroundStyle(.secondary)
                }
                if let candidate = model.handoffCandidates[row.id] {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Updated handoff ready · your edits are still intact").font(.headline)
                        ScrollView { Text(candidate.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(height: 180)
                        HStack {
                            Button("Use generated handoff") { model.acceptHandoff(row) }
                            Button("Keep mine") { model.handoffCandidates.removeValue(forKey: row.id) }
                        }
                    }.padding(12).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
                if model.handoffs[row.id] != nil {
                TextEditor(text: Binding(get: { model.draft(for: row) }, set: { model.setDraft($0, for: row.id) }))
                    .font(.system(size: 13)).frame(minHeight: 250).border(.quaternary)
                    .accessibilityLabel("Editable handoff")
                }
                HStack {
                    Button("Copy") { Task { await model.copyHandoff(row) } }
                    Button("Export…") { Task { await model.export(row) } }
                    if model.handoffBackups[row.id] != nil {
                        Button("Restore previous text") { model.restoreHandoff(row) }
                    }
                }.disabled(model.draft(for: row).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Start fresh with this handoff…", action: startFresh)
                    .buttonStyle(.borderedProminent)
                    .disabled(row.simulated || model.draft(for: row).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || generating)
                DisclosureGroup("Recorded activity · source excerpts") {
                    if let context = model.contexts[row.id] {
                        Text(context.text).font(.caption).textSelection(.enabled)
                    }
                    Button("Refresh recorded activity") { Task { await model.appendHistory(row) } }
                        .disabled(model.historyLoading.contains(row.id))
                }.font(.caption)
            }
        }.onAppear {
            if !model.handoffProviders.contains(model.handoffAIProvider), let first = model.handoffProviders.first {
                model.handoffAIProvider = model.handoffProviders.contains(row.provider) ? row.provider : first
            }
        }
    }
}
