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
    @Environment(\.dismiss) private var dismiss
    @ViewState private var query = ""
    @ViewState private var selection: UUID?
    @ViewState private var tool = "All tools"
    @ViewState private var project = "All projects"
    private var records: [SavedWork] { model.savedWork.filter { $0.matches(query) && (tool == "All tools" || $0.sourceProvider == tool) && (project == "All projects" || $0.project == project) }.sorted { $0.createdAt > $1.createdAt } }
    private var selectedRecord: SavedWork? { model.savedWork.first { $0.id == selection } ?? records.first }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Saved work").font(.title2.bold())
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Independent summaries and handoffs. Deleting a session does not delete these records.")
                .font(.caption).foregroundStyle(.secondary)
            TextField("Search titles, projects, dates, or saved content", text: $query).textFieldStyle(.roundedBorder)
            HStack {
                Picker("Tool", selection: $tool) {
                    Text("All tools").tag("All tools")
                    ForEach(Array(Set(model.savedWork.map(\.sourceProvider))).sorted(), id: \.self) { Text($0).tag($0) }
                }
                Picker("Project", selection: $project) {
                    Text("All projects").tag("All projects")
                    ForEach(Array(Set(model.savedWork.map(\.project))).sorted(), id: \.self) { Text($0.replacingOccurrences(of: NSHomeDirectory(), with: "~")).tag($0) }
                }
                if tool != "All tools" || project != "All projects" {
                    Button("Clear filters") { tool = "All tools"; project = "All projects" }
                }
            }
            Text("Library filters are separate from session filters.").font(.caption2).foregroundStyle(.secondary)
            if let error = model.workError { Text(error).foregroundStyle(.orange).font(.caption) }
            if records.isEmpty && selectedRecord == nil {
                ContentUnavailableView(query.isEmpty && tool == "All tools" && project == "All projects" ? "No saved work yet" : "No matching records", systemImage: "books.vertical", description: Text("Choose Save work summary from a session’s actions, or Save to library from its handoff."))
            } else {
                HStack(alignment: .top, spacing: 16) {
                    ScrollView {
                        VStack(spacing: 8) {
                            ForEach(records) { record in
                                Button { selection = record.id } label: {
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(record.title).font(.headline).lineLimit(2)
                                        Text(URL(fileURLWithPath: record.project).lastPathComponent + " · " + record.kind).font(.caption)
                                        Text(record.createdAt, style: .date).font(.caption2)
                                    }.foregroundStyle(.primary).frame(maxWidth: .infinity, alignment: .leading).padding(10)
                                        .background((selection ?? records.first?.id) == record.id ? HuddleStyle.accent.opacity(0.15) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                                }.buttonStyle(.plain)
                            }
                        }
                    }.frame(width: 230)
                    Divider()
                    if let record = selectedRecord {
                        SavedWorkEditor(id: record.id).id(record.id)
                    }
                }
            }
        }.padding(24).frame(width: 860, height: 650).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .onAppear { selection = records.first?.id }
            .onChange(of: query) { _, _ in selection = records.first?.id }
            .onChange(of: tool) { _, _ in selection = records.first?.id }
            .onChange(of: project) { _, _ in selection = records.first?.id }
    }
}

struct SavedWorkEditor: View {
    @EnvironmentObject var model: AppModel
    let id: UUID
    @ViewState private var confirmDelete = false
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
                Text("\(record.kind) · \(record.sourceProvider) · saved \(record.createdAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Edits save automatically. This record is independent of the original session.")
                    .font(.caption2).foregroundStyle(.secondary)
                TextEditor(text: binding(\.text)).font(.system(size: 13)).border(.quaternary)
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
                    Button("Copy") { model.copy(record.markdown) }
                    Button("Export Markdown…") { model.exportWork(record) }
                    Spacer()
                    Button("Delete record…", role: .destructive) { confirmDelete = true }
                }
            }.confirmationDialog("Delete this saved record? This does not delete its original session.", isPresented: $confirmDelete) {
                Button("Delete record", role: .destructive) { model.deleteWork(record) }
            }
        }
    }
}
