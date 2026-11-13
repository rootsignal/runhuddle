import SwiftUI
import SessionCore

struct HandoffEditor: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    @ViewState private var isolated = false
    @ViewState private var createdWorkspace: String?
    @ViewState private var allowShared = false
    @ViewState private var branch = "runhuddle/work-" + String(UUID().uuidString.prefix(8)).lowercased()
    @ViewState private var snapshot = ""
    @ViewState private var questions = ""
    @ViewState private var nextSteps = ""
    @ViewState private var projectNote = ""
    @ViewState private var snapshotLoading = false
    private var workspacePath: String { ProjectWorkspace.destination(directory: row.cwd, suffix: branch.split(separator: "/").last.map(String.init) ?? "work") }

    @Environment(\.dismiss) private var dismiss
    @ViewState private var destination = ""
    @ViewState private var agents: [String] = []
    @ViewState private var launching = false
    @ViewState private var failure: String?
    @ViewState private var allowWorking = false
    private var reviewedContext: String {
        "## Repository snapshot\n" + snapshot + "\n\n## Unresolved questions\n" + questions + "\n\n## Next steps\n" + nextSteps + "\n\n## Project note\n" + projectNote
    }
    private var extrasKey: String { "handoffReviewExtras." + row.id + ".continue" }
    private func saveExtras() {
        UserDefaults.standard.set(["snapshot": snapshot, "questions": questions, "nextSteps": nextSteps, "projectNote": projectNote], forKey: extrasKey)
    }
    private var current: Session { model.sessions.first { $0.id == row.id } ?? row }
    private var working: Bool { [.working, .needsInput].contains(current.state) }
    private var generating: Bool { model.handoffGenerating.contains(row.id) }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Start fresh with a handoff").font(.title2.bold())
            Text("Review the handoff below. Starting sends it as the first prompt and opens the new terminal in this project.").foregroundStyle(.secondary)
            Picker("New session agent", selection: $destination) {
                ForEach(agents, id: \.self) { Text($0).tag($0) }
            }.disabled(launching)
            WorkspaceLaunchOptions(directory: row.cwd, isolated: $isolated, allowShared: $allowShared, branch: $branch, destination: workspacePath)
            Text(row.cwd).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            if working {
                Label("The original agent is still working or waiting for input.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                Toggle("Start another session alongside it", isOn: $allowWorking)
            } else if current.state == .idle {
                Text("The original session is idle and will remain open.").font(.caption).foregroundStyle(.secondary)
            }
            ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Handoff review").font(.headline)
                Text("The original session stays available, linked to its continuation.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    Picker("Generate with", selection: $model.handoffAIProvider) {
                        ForEach(model.handoffProviders, id: \.self) { Text($0).tag($0) }
                    }.disabled(generating)
                    Button(generating ? "Generating…" : model.handoffs[row.id] == nil ? "Generate handoff" : "Update handoff") {
                        Task { await model.generateHandoff(current) }
                    }.disabled(generating || row.simulated || model.handoffProviders.isEmpty)
                    if generating { ProgressView().controlSize(.small) }
                }
                Text("Sends recorded history and your notes to the selected AI using its signed-in CLI account. Uses your plan’s allowance. Your active session is not interrupted.")
                    .font(.caption).foregroundStyle(.secondary)
                if generating {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.handoffProgress[row.id] ?? "Preparing handoff…").font(.headline)
                        Text("AI generation can take a minute or two, especially for longer sessions. You can close this review and return later; saved handoff text is retained.")
                            .font(.callout).foregroundStyle(.secondary)
                    }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
                }
                if let failure = model.handoffErrors[row.id] { Text(failure).font(.callout).foregroundStyle(.orange).textSelection(.enabled) }
                if let generated = model.handoffs[row.id] {
                    Text("Generated with \(generated.provider) · \(generated.generatedAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                    if generated.hasEdits(model.draft(for: row)) { Text("Edited by you · changes saved automatically").font(.caption).foregroundStyle(.secondary) }
                    if model.handoffIsStale(current) {
                        Label("This session has newer activity or notes—update the draft before continuing.", systemImage: "clock.arrow.circlepath")
                            .font(.caption).foregroundStyle(.orange)
                    }
                } else if !generating {
                    Text("No handoff is ready yet. Generate one to continue.").foregroundStyle(.secondary)
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
                if model.handoffs[row.id] != nil || !model.draft(for: row).isEmpty {
                TextEditor(text: Binding(get: { model.draft(for: row) }, set: { model.setDraft($0, for: row.id) }))
                    .font(.system(size: 13)).frame(minHeight: 250).border(.quaternary)
                    .accessibilityLabel("Editable handoff")
                }
                Text("Unresolved questions").font(.headline)
                TextField("Questions for the receiving agent", text: $questions, axis: .vertical).textFieldStyle(.roundedBorder)
                Text("Next steps").font(.headline)
                TextField("What should happen next?", text: $nextSteps, axis: .vertical).textFieldStyle(.roundedBorder)
                if !projectNote.isEmpty {
                    Text("Project note").font(.headline)
                    TextEditor(text: $projectNote).frame(height: 70).border(.quaternary)
                }
                DisclosureGroup("Repository snapshot to send") {
                    Button(snapshotLoading ? "Reading…" : "Refresh snapshot") { Task { await captureSnapshot() } }.disabled(snapshotLoading)
                    TextEditor(text: $snapshot).font(.system(size: 11, design: .monospaced)).frame(height: 160).border(.quaternary)
                    Text("Timestamped project state, shared with other sessions. The receiving agent must verify it again.").font(.caption).foregroundStyle(.secondary)
                }
                DisclosureGroup("Other handoff actions") {
                    HStack {
                        Button("Copy handoff") { model.copy(model.completeHandoff(row) + "\n\n" + reviewedContext) }
                        Button("Save to Notes") { model.preserveHandoff(row, additionalContext: reviewedContext) }
                        Button("Export…") { Task { await model.export(row, additionalContext: reviewedContext) } }
                    }.disabled(model.draft(for: row).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if model.handoffBackups[row.id] != nil {
                        Button("Restore previous text") { model.restoreHandoff(row) }
                    }
                }
                if let notice = model.workNotice { Text(notice).font(.caption).foregroundStyle(.secondary) }
                if let error = model.workError { Text(error).font(.caption).foregroundStyle(.orange) }
                DisclosureGroup("Recorded activity · source excerpts") {
                    if let context = model.contexts[row.id] {
                        Text(context.text).font(.caption).textSelection(.enabled)
                    }
                    Button("Refresh recorded activity") { Task { await model.appendHistory(row) } }
                        .disabled(model.historyLoading.contains(row.id))
                }.font(.caption)
            }
            }
            if let failure { Text(failure).font(.callout).foregroundStyle(.orange) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(launching)
                Spacer()
                Button("Start fresh session") {
                    launching = true
                    Task {
                        do {
                            let path: String
                            if isolated {
                                if let createdWorkspace { path = createdWorkspace }
                                else { path = try await ProjectWorkspace.create(directory: row.cwd, branch: branch, destination: workspacePath); createdWorkspace = path }
                            } else { path = row.cwd }
                            let context = reviewedContext
                            failure = model.startContinuation(row, provider: destination, allowWorking: allowWorking, directory: path, additionalContext: context, relationship: isolated ? "branched" : "continued")
                            if failure != nil && isolated { failure = (failure ?? "") + " Workspace retained at " + path }
                        } catch { failure = error.localizedDescription }
                        launching = false
                        if failure == nil { dismiss() }
                    }
                }.buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                    .disabled(launching || generating || snapshotLoading || (!isolated && model.hasOpenSession(in: row.cwd) && !allowShared) || !agents.contains(destination) || (working && !allowWorking) || model.handoffCandidates[row.id] != nil || model.draft(for: row).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(24).frame(width: 660, height: 680).interactiveDismissDisabled(launching)
        .onChange(of: branch) { _, _ in createdWorkspace = nil }
        .onChange(of: snapshot) { _, _ in saveExtras() }
        .onChange(of: questions) { _, _ in saveExtras() }
        .onChange(of: nextSteps) { _, _ in saveExtras() }
        .onChange(of: projectNote) { _, _ in saveExtras() }
        .task {
            if let saved = UserDefaults.standard.dictionary(forKey: extrasKey) as? [String: String] {
                snapshot = saved["snapshot"] ?? ""; questions = saved["questions"] ?? ""
                nextSteps = saved["nextSteps"] ?? ""; projectNote = saved["projectNote"] ?? ""
            } else {
                projectNote = ProjectPreferencesStore.shared.value(row.cwd).note
                nextSteps = model.briefs[row.id]?.nextStep ?? ""
                await captureSnapshot()
            }
            model.workNotice = nil; model.workError = nil
            agents = model.installedLaunchAgents()
            destination = agents.contains(row.provider) ? row.provider : (agents.first ?? "")
            if !model.handoffProviders.contains(model.handoffAIProvider), let first = model.handoffProviders.first {
                model.handoffAIProvider = model.handoffProviders.contains(row.provider) ? row.provider : first
            }
            if agents.isEmpty { failure = "Install and sign in to an agent to start a new session." }
            if (model.draft(for: row).isEmpty || model.handoffIsStale(current)), model.handoffCandidates[row.id] == nil, !generating {
                await model.generateHandoff(current)
            }
        }
    }
    private func captureSnapshot() async {
        snapshotLoading = true
        defer { snapshotLoading = false }
        do {
            let changes = try await ProjectChanges.read(row.cwd)
            snapshot = changes.handoffSnapshot
        } catch { snapshot = "Repository snapshot unavailable: " + error.localizedDescription }
    }

}
