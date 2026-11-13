import SwiftUI
import SessionCore

struct WorkSummaryComposer: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let source: Session
    @ViewState private var record: SavedWork
    @ViewState private var generating = false
    @ViewState private var focus = ""
    @ViewState private var sessionReport = false
    @ViewState private var failure: String?
    @ViewState private var confirmDiscard = false
    init(source: Session, title: String) {
        self.source = source
        _record = ViewState(initialValue: SavedWork(session: source, title: title, kind: "Project note"))
    }
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 12) {
            Text("Save as project note").font(.title2.bold())
            Text("Capture a solution, decision, or guide for this project. Review and edit the Markdown before saving.")
                .font(.callout).foregroundStyle(.secondary)
            Picker("Capture", selection: $sessionReport) {
                Text("Project note").tag(false)
                Text("Session report").tag(true)
            }.pickerStyle(.segmented).disabled(generating || !record.text.isEmpty)
            Text(sessionReport ? "A record of outcomes, evidence, and unfinished work." : "Reusable knowledge about one topic; release history and temporary status are left out.")
                .font(.caption).foregroundStyle(.secondary)
            TextField("Title", text: $record.title).textFieldStyle(.roundedBorder)
            Text("\(source.provider) · \(source.cwd)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
            TextField("Capture focus (optional) · e.g. the fix, decisions, or setup steps", text: $focus).textFieldStyle(.roundedBorder).disabled(generating)
            HStack {
                Picker("Generate with", selection: $model.handoffAIProvider) {
                    ForEach(model.handoffProviders, id: \.self) { Text($0).tag($0) }
                }.disabled(generating)
                Button(generating ? "Generating…" : (sessionReport ? "Generate report" : "Generate note")) {
                    generating = true; failure = nil
                    Task {
                        do {
                            let generated = try await model.generateWorkSummary(source, focus: focus, sessionReport: sessionReport)
                            let customTitle = record.title != source.title && record.title != model.displayName(for: source) ? record.title : nil
                            record = generated
                            if let customTitle { record.title = customTitle }
                        } catch { failure = error.localizedDescription }
                        generating = false
                    }
                }.disabled(generating || !record.text.isEmpty || model.handoffProviders.isEmpty)
            }
            Text(generating ? "Reading history and generating your draft can take a minute or two. Nothing is saved until you review it and choose Save." : "Optional: sends recorded history and notes to your selected AI CLI account and uses its allowance. Or write your own note below.")
                .font(.caption).foregroundStyle(.secondary)
            if generating { ProgressView().controlSize(.small) }
            if let failure { Text(failure).font(.caption).foregroundStyle(.orange) }
            if let error = model.workError { Text(error).font(.caption).foregroundStyle(.orange) }
            TextEditor(text: $record.text).font(.system(size: 13)).frame(minHeight: 260)
                .border(.quaternary).disabled(generating).accessibilityLabel("Project note Markdown")
            HStack {
                Button("Cancel") {
                    if record.text.isEmpty { dismiss() } else { confirmDiscard = true }
                }.disabled(generating)
                Spacer()
                Button("Save note") {
                    if record.generatedBy == nil && sessionReport {
                        record = SavedWork(session: source, title: record.title, text: record.text, kind: "Session report")
                    }
                    record.updatedAt = Date()
                    if model.saveWork(record) { dismiss() }
                }.buttonStyle(.borderedProminent)
                    .disabled(generating || record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || record.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(24)
        }.frame(width: 640, height: 720).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .interactiveDismissDisabled()
            .confirmationDialog("Discard this unsaved summary?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { dismiss() }
            }
            .onAppear {
                model.workError = nil
                if !model.handoffProviders.contains(model.handoffAIProvider), let provider = model.handoffProviders.first { model.handoffAIProvider = provider }
            }
    }
}

struct SavedWorkLibrary: View {
    @EnvironmentObject var model: AppModel
    @ViewState private var selection: UUID?
    @ViewState private var showDetails = false
    @ViewState private var tool = "All tools"
    private var project: String { model.notesProjectFilter }
    private var records: [SavedWork] {
        model.savedWork.filter { $0.matches(model.libraryQuery) && (tool == "All tools" || $0.sourceProvider == tool) && (project == "All projects" || $0.belongs(to: project)) }.sorted { $0.updatedAt > $1.updatedAt }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text(project == "All projects" ? "All notes" : "Project notes").font(.system(size: 22, weight: .semibold, design: .rounded))
                Text("\(records.count) \(records.count == 1 ? "note" : "notes") · knowledge to reuse").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Picker("Tool", selection: $tool) {
                        Text("All tools").tag("All tools")
                        ForEach(Array(Set(model.savedWork.map(\.sourceProvider))).sorted(), id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Project", selection: $model.notesProjectFilter) {
                        Text("All projects").tag("All projects")
                        ForEach(Array(Set(model.savedWork.map(\.project) + (project == "All projects" ? [] : [project]))).sorted(), id: \.self) { Text($0.replacingOccurrences(of: NSHomeDirectory(), with: "~")).tag($0) }
                    }
                    if tool != "All tools" || project != "All projects" {
                        Button("Clear filters") { tool = "All tools"; model.notesProjectFilter = "All projects" }
                    }
                }
                if let error = model.workError { Text(error).font(.caption).foregroundStyle(.orange) }
            }.padding(.horizontal, 20).padding(.top, 12)
            SessionColumns(showDetails: showDetails && selection != nil) {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(records) { record in
                            Button { selection = record.id; showDetails = true } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text(record.title).font(.headline).lineLimit(2)
                                    Text(URL(fileURLWithPath: record.project).lastPathComponent + " · " + record.kind).font(.caption).foregroundStyle(.secondary)
                                    Text(HuddleStyle.inline(SessionPresentation.excerpt(record.text, limit: 240))).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
                                    Text(record.createdAt, style: .date).font(.caption2).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                                    .modifier(SessionCardSurface(selected: selection == record.id))
                            }.buttonStyle(.plain)
                        }
                    }.padding(14)
                }.overlay {
                    if records.isEmpty {
                        VStack(spacing: 12) {
                            ContentUnavailableView(model.savedWork.isEmpty ? "Keep what you learned" : "No matching notes", systemImage: "books.vertical", description: Text(model.savedWork.isEmpty ? "Choose Save as project note from a session to capture knowledge. Notes remain available even if the source session is deleted." : "Try another search or clear your library filters."))
                            if !model.savedWork.isEmpty {
                                Button("Clear search and filters") { model.libraryQuery = ""; tool = "All tools"; model.notesProjectFilter = "All projects" }
                            }
                        }
                    }
                }
            } detail: {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("NOTE").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button { showDetails = false } label: { Image(systemName: "xmark") }.buttonStyle(QuietIconButtonStyle()).help("Close note").accessibilityLabel("Close note")
                    }
                    if let selection { SavedWorkEditor(id: selection).id(selection) }
                }.padding(18).background(HuddleStyle.panel)
            }
        }.background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .onChange(of: model.libraryQuery) { _, _ in reconcileSelection() }
            .onChange(of: tool) { _, _ in reconcileSelection() }
            .onChange(of: project) { _, _ in reconcileSelection() }
            .onChange(of: model.savedWork.map(\.id)) { _, _ in reconcileSelection() }
    }
    private func reconcileSelection() {
        if !records.contains(where: { $0.id == selection }) { selection = nil; showDetails = false }
    }
}

struct SavedWorkEditor: View {
    @EnvironmentObject var model: AppModel
    let id: UUID
    @ViewState private var confirmDelete = false
    @ViewState private var startSession = false
    @ViewState private var copied = false
    private var record: SavedWork? { model.savedWork.first { $0.id == id } }
    private func binding(_ key: WritableKeyPath<SavedWork, String>) -> Binding<String> {
        Binding(get: { record?[keyPath: key] ?? "" }, set: { value in
            guard var updated = record else { return }
            updated[keyPath: key] = value; updated.updatedAt = Date()
            model.saveWork(updated)
        })
    }
    var body: some View {
        if let record {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Title", text: binding(\.title)).textFieldStyle(.roundedBorder)
                Button { startSession = true } label: { Label("Use in a new session…", systemImage: "play.rectangle") }
                    .buttonStyle(.borderedProminent).disabled(model.navigatingTerminal || record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Text("\(record.kind) · \(record.sourceProvider) · saved \(record.createdAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
                Label("Changes save automatically", systemImage: "checkmark.circle")
                    .help("This saved record is independent of the original session.")
                    .font(.caption2).foregroundStyle(.secondary)
                TextEditor(text: binding(\.text)).font(.system(size: 13)).scrollContentBackground(.hidden)
                    .padding(8).background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(HuddleStyle.border))
                    .accessibilityLabel("Note Markdown")
                if model.sessions.contains(where: { $0.id == record.sourceID }) {
                    Button("Open source session") { EmbeddedTerminals.shared.presentedID = nil; model.showSession(record.sourceID) }
                }
                DisclosureGroup("Source and provenance") {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(record.project)
                        Text(record.sourceProvider + " / " + record.sourceSessionID)
                        Text(record.generatedBy.map { "Generated with " + $0 + "; reviewed/edited record, not independently verified." } ?? "User-written record")
                        if let date = record.generatedAt { Text("Generated " + date.formatted()) }
                        Text("Source activity " + Date(timeIntervalSince1970: record.sourceUpdated).formatted())
                        Text("Edited " + record.updatedAt.formatted())
                        if !model.sessions.contains(where: { $0.id == record.sourceID }) { Text("Original session is not currently available.") }
                    }.font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                }.font(.caption)
                HStack {
                    Button { model.copy(record.markdown); copied = true } label: { Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc") }
                    Spacer()
                    Menu {
                        Button("Export Markdown…") { model.exportWork(record) }
                        Divider()
                        Button("Delete note…", role: .destructive) { confirmDelete = true }
                    } label: { Label("More", systemImage: "ellipsis") }
                    .fixedSize()
                }
            }.sheet(isPresented: $startSession) { SavedWorkLaunchView(record: record) }
            .onChange(of: record.text) { _, _ in copied = false }
            .confirmationDialog("Delete this note? This does not delete its original session.", isPresented: $confirmDelete) {
                Button("Delete note", role: .destructive) { model.deleteWork(record) }
            }
        }
    }
}

struct SavedWorkLaunchView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let record: SavedWork
    @ViewState private var provider: String
    @ViewState private var directory: String
    @ViewState private var prompt: String
    @ViewState private var busy = false
    @ViewState private var isolated = false
    @ViewState private var allowShared = false
    @ViewState private var branch = "runhuddle/work-" + String(UUID().uuidString.prefix(8)).lowercased()
    private var workspacePath: String { ProjectWorkspace.destination(directory: (directory as NSString).expandingTildeInPath, suffix: branch.split(separator: "/").last.map(String.init) ?? "work") }
    init(record: SavedWork) {
        self.record = record
        _provider = ViewState(initialValue: record.sourceProvider)
        _directory = ViewState(initialValue: record.project)
        _prompt = ViewState(initialValue: SavedWork.referencePrompt([record]))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Use note in a new session").font(.title2.bold())
            Text("Opens a new session inside RunHuddle and sends the prompt below to your selected agent using its signed-in account. Only the text below is sent. Add your task or question before starting; the note remains unchanged.")
                .font(.callout).foregroundStyle(.secondary)
            Picker("Agent", selection: $provider) {
                ForEach(["Codex", "Claude", "Copilot"], id: \.self) { Text($0).tag($0) }
            }
            HStack {
                TextField("Project folder", text: $directory).textFieldStyle(.roundedBorder)
                Button("Choose…") {
                    let panel = NSOpenPanel()
                    panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
                    if panel.runModal() == .OK, let url = panel.url { directory = url.path }
                }
            }
            WorkspaceLaunchOptions(directory: directory, isolated: $isolated, allowShared: $allowShared, branch: $branch, destination: workspacePath)
            Text("Initial prompt — review or edit before starting").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $prompt).font(.system(size: 13)).border(.quaternary)
                .accessibilityLabel("Initial prompt for new session")
            if let error = model.workError { Text(error).font(.caption).foregroundStyle(.orange) }
            HStack {
                Button("Cancel") { dismiss() }.disabled(busy)
                Spacer()
                Button("Start session") {
                    busy = true
                    let path = (directory as NSString).expandingTildeInPath
                    Task {
                        do {
                            let chosen = isolated ? try await ProjectWorkspace.create(directory: path, branch: branch, destination: workspacePath) : path
                            if isolated { directory = chosen; isolated = false }
                            if model.startFromSavedWork(record, provider: provider, directory: chosen, prompt: prompt) { dismiss() }
                        } catch { model.workError = error.localizedDescription }
                        busy = false
                    }
                }.buttonStyle(.borderedProminent)
                    .disabled(busy || (!isolated && model.hasOpenSession(in: directory) && !allowShared) || model.navigatingTerminal || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || directory.isEmpty)
            }
        }.padding(24).frame(width: 610, height: 690).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .interactiveDismissDisabled(busy)
            .onAppear { model.workError = nil; let choice = ProjectPreferencesStore.shared.value(directory).agent; if model.installedLaunchAgents().contains(choice) { provider = choice } }
    }
}
