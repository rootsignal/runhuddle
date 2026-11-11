import SwiftUI
import SessionCore

struct WorkSummaryComposer: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let source: Session
    @ViewState private var record: SavedWork
    @ViewState private var generating = false
    @ViewState private var failure: String?
    @ViewState private var confirmDiscard = false
    init(source: Session, title: String) {
        self.source = source
        _record = ViewState(initialValue: SavedWork(session: source, title: title))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Save work summary").font(.title2.bold())
            Text("Keep a useful record after the original session is deleted. Review AI claims and fill in missing decisions or evidence before saving.")
                .font(.callout).foregroundStyle(.secondary)
            TextField("Title", text: $record.title).textFieldStyle(.roundedBorder)
            Text("\(source.provider) · \(source.cwd)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
            HStack {
                Picker("Generate with", selection: $model.handoffAIProvider) {
                    ForEach(model.handoffProviders, id: \.self) { Text($0).tag($0) }
                }.disabled(generating)
                Button(generating ? "Generating…" : "Generate summary") {
                    generating = true; failure = nil
                    Task {
                        do {
                            let generated = try await model.generateWorkSummary(source)
                            record.text = generated.text
                            record.generatedBy = generated.generatedBy; record.generatedAt = generated.generatedAt
                        } catch { failure = error.localizedDescription }
                        generating = false
                    }
                }.disabled(generating || !record.text.isEmpty || model.handoffProviders.isEmpty)
            }
            Text(generating ? "Reading history and generating a summary can take a minute or two. Nothing is saved until you review it and choose Save." : "Optional: sends recorded history and notes to your selected AI CLI account and uses its allowance. Or write your own summary below.")
                .font(.caption).foregroundStyle(.secondary)
            if generating { ProgressView().controlSize(.small) }
            if let failure { Text(failure).font(.caption).foregroundStyle(.orange) }
            if let error = model.workError { Text(error).font(.caption).foregroundStyle(.orange) }
            TextEditor(text: $record.text).font(.system(size: 13)).frame(minHeight: 260)
                .border(.quaternary).disabled(generating).accessibilityLabel("Work summary draft")
            HStack {
                Button("Cancel") {
                    if record.text.isEmpty { dismiss() } else { confirmDiscard = true }
                }.disabled(generating)
                Spacer()
                Button("Save to library") {
                    record.updatedAt = Date()
                    if model.saveWork(record) { dismiss() }
                }.buttonStyle(.borderedProminent)
                    .disabled(generating || record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || record.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(24).frame(width: 640, height: 640).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
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
    @ViewState private var project = "All projects"
    private var records: [SavedWork] {
        model.savedWork.filter { $0.matches(model.libraryQuery) && (tool == "All tools" || $0.sourceProvider == tool) && ProjectFilter.matches($0.project, selection: project) }.sorted { $0.createdAt > $1.createdAt }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Saved work").font(.system(size: 22, weight: .semibold, design: .rounded))
                Text("\(records.count) saved \(records.count == 1 ? "record" : "records") · ready to revisit or continue").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Picker("Tool", selection: $tool) {
                        Text("All tools").tag("All tools")
                        ForEach(Array(Set(model.savedWork.map(\.sourceProvider))).sorted(), id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Project", selection: $project) {
                        Text("All projects").tag("All projects")
                        ForEach(ProjectFilter.options(model.savedWork.map(\.project)), id: \.self) { Text($0.replacingOccurrences(of: NSHomeDirectory(), with: "~")).tag($0) }
                    }
                    if tool != "All tools" || project != "All projects" {
                        Button("Clear filters") { tool = "All tools"; project = "All projects" }
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
                            ContentUnavailableView(model.savedWork.isEmpty ? "Keep the work worth returning to" : "No matching saved work", systemImage: "books.vertical", description: Text(model.savedWork.isEmpty ? "Save a summary or handoff from any session. It stays here even after that session is deleted." : "Try another search or clear your library filters."))
                            if !model.savedWork.isEmpty {
                                Button("Clear search and filters") { model.libraryQuery = ""; tool = "All tools"; project = "All projects" }
                            }
                        }
                    }
                }
            } detail: {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("SAVED WORK DETAILS").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button { showDetails = false } label: { Image(systemName: "xmark") }.buttonStyle(QuietIconButtonStyle()).help("Close saved work details").accessibilityLabel("Close saved work details")
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
                Button { startSession = true } label: { Label("Continue in a new session…", systemImage: "play.rectangle") }
                    .buttonStyle(.borderedProminent).disabled(model.navigatingTerminal || record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Text("\(record.kind) · \(record.sourceProvider) · saved \(record.createdAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
                Label("Changes save automatically", systemImage: "checkmark.circle")
                    .help("This saved record is independent of the original session.")
                    .font(.caption2).foregroundStyle(.secondary)
                TextEditor(text: binding(\.text)).font(.system(size: 13)).scrollContentBackground(.hidden)
                    .padding(8).background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(HuddleStyle.border))
                    .accessibilityLabel("Saved work content")
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
                        Button("Delete record…", role: .destructive) { confirmDelete = true }
                    } label: { Label("More", systemImage: "ellipsis") }
                    .fixedSize()
                }
            }.sheet(isPresented: $startSession) { SavedWorkLaunchView(record: record) }
            .onChange(of: record.text) { _, _ in copied = false }
            .confirmationDialog("Delete this saved record? This does not delete its original session.", isPresented: $confirmDelete) {
                Button("Delete record", role: .destructive) { model.deleteWork(record) }
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
    init(record: SavedWork) {
        self.record = record
        _provider = ViewState(initialValue: record.sourceProvider)
        _directory = ViewState(initialValue: record.project)
        _prompt = ViewState(initialValue: "Continue from this saved work record. It may be incomplete or outdated. First inspect the current project state and ask about unclear next steps.\n\n" + record.markdown)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Start a new session").font(.title2.bold())
            Text("Opens a new Terminal session and sends the prompt below to your selected agent using its signed-in account. The saved record and original session remain unchanged.")
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
            Text("Initial prompt — review or edit before starting").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $prompt).font(.system(size: 13)).border(.quaternary)
                .accessibilityLabel("Initial prompt for new session")
            if let error = model.workError { Text(error).font(.caption).foregroundStyle(.orange) }
            HStack {
                Button("Cancel") { dismiss() }
                Spacer()
                Button("Start in preferred terminal") {
                    let path = (directory as NSString).expandingTildeInPath
                    if model.startFromSavedWork(record, provider: provider, directory: path, prompt: prompt) { dismiss() }
                }.buttonStyle(.borderedProminent)
                    .disabled(model.navigatingTerminal || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || directory.isEmpty)
            }
        }.padding(24).frame(width: 610, height: 560).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .onAppear { model.workError = nil }
    }
}
