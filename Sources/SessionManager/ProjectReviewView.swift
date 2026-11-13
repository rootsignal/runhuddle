import SwiftUI
import SessionCore

struct ProjectReviewView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let row: Session
    var initialPaths: Set<String>? = nil
    @ViewState private var appliedInitialScope = false
    @ViewState private var reviewer = ""
    @ViewState private var agents: [String] = []
    @ViewState private var focus = ""
    @ViewState private var context = ""
    @ViewState private var changes: ProjectChanges?
    @ViewState private var selected: Set<String> = []
    @ViewState private var prepared: ProjectReview?
    @ViewState private var busy = false
    @ViewState private var failure: String?
    @ViewState private var preview = false
    @ViewState private var work: Task<Void, Never>?
    private var canStart: Bool { !busy && agents.contains(reviewer) && !selected.isEmpty && changes != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Review project changes").font(.title2.bold())
            Text("Ask another agent for findings on your current changes.").foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Picker("Reviewer", selection: $reviewer) {
                        ForEach(agents, id: \.self) { Text($0).tag($0) }
                    }
                    if agents.isEmpty && !busy { Text("Install and sign in to an agent to start a review.").font(.caption).foregroundStyle(.orange) }
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Current uncommitted changes").font(.headline)
                        Text(changes?.root ?? row.cwd).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        if let changes {
                            HStack {
                                Text("\(changes.branch) · \(selected.count) of \(changes.files.count) files selected").font(.caption)
                                Spacer()
                                Button("Refresh") { beginRefresh() }
                            }
                            if changes.files.isEmpty {
                                Text("No uncommitted changes to review. Make changes, then refresh.").font(.callout).foregroundStyle(.secondary)
                            } else {
                                DisclosureGroup("Choose files") {
                                    HStack {
                                        Button("Select all") { selected = Set(changes.files.map(\.path)) }
                                        Button("Clear") { selected = [] }
                                    }.font(.caption)
                                    ScrollView {
                                        LazyVStack(alignment: .leading, spacing: 6) {
                                            ForEach(changes.files) { file in
                                                Toggle(isOn: Binding(get: { selected.contains(file.path) }, set: { if $0 { selected.insert(file.path) } else { selected.remove(file.path) } })) {
                                                    Text(file.path).font(.caption).lineLimit(2).help(file.path)
                                                }
                                            }
                                        }
                                    }.frame(maxHeight: 160)
                                }.font(.caption)
                            }
                        }
                    }
                    TextField("Review focus (optional) · e.g. bugs and missing tests", text: $focus, axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(2...4)
                    DisclosureGroup("Brief task context") {
                        TextField("What are these changes intended to do?", text: $context, axis: .vertical)
                            .textFieldStyle(.roundedBorder).lineLimit(2...4)
                    }.font(.caption)
                    Text("Sends a short request with your scope and focus. The reviewer reads changes locally; no diff or file contents are attached. Normal agent permissions apply.")
                        .font(.caption).foregroundStyle(.secondary)
                    if model.hasOpenSession(in: row.cwd) {
                        Text("Another agent is open here. Files may change during the review; the reviewer will be asked to check the current state.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let prepared {
                        Text("Request: \(prepared.prompt.utf8.count.formatted()) bytes · instructions and scope only").font(.caption).foregroundStyle(.secondary)
                    }
                }.disabled(busy)
            }
            if busy { ProgressView("Reading project changes…").controlSize(.small) }
            if let failure { Text(failure).font(.callout).foregroundStyle(.orange) }
            HStack {
                Button("Cancel") { work?.cancel(); dismiss() }
                Spacer()
                Button("Preview request…") { prepare(start: false) }.disabled(!canStart)
                Button("Start review") { prepare(start: true) }.buttonStyle(.borderedProminent).disabled(!canStart)
            }
        }.padding(24).frame(width: 600, height: 530)
            .interactiveDismissDisabled(busy)
            .task {
                agents = model.installedLaunchAgents()
                reviewer = agents.first { $0 != row.provider } ?? agents.first ?? ""
                context = model.briefs[row.id]?.purpose.isEmpty == false ? model.briefs[row.id]!.purpose : model.displayName(for: row)
                await refresh()
            }
            .onDisappear { work?.cancel() }
            .onChange(of: selected) { _, _ in prepared = nil }
            .onChange(of: focus) { _, _ in prepared = nil }
            .onChange(of: context) { _, _ in prepared = nil }
            .sheet(isPresented: $preview) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("Review request").font(.headline); Spacer(); Button("Done") { preview = false } }
                    ProjectDiffText(text: prepared?.prompt ?? "")
                }.padding(20).frame(width: 700, height: 540)
            }
    }
    private func beginRefresh() { work = Task { await refresh() } }
    private func refresh() async {
        busy = true; failure = nil; prepared = nil
        defer { busy = false }
        do {
            let value = try await ProjectChanges.read(row.cwd, includeLineCounts: false)
            try Task.checkCancellation()
            changes = value
            let available = Set(value.files.map(\.path))
            selected = !appliedInitialScope ? (initialPaths.map { $0.intersection(available) } ?? available) : selected.intersection(available)
            appliedInitialScope = true
        } catch is CancellationError {} catch { changes = nil; selected = []; failure = error.localizedDescription }
    }
    private func prepare(start: Bool) {
        guard let changes, canStart else { return }
        busy = true; failure = nil
        work = Task {
            defer { busy = false }
            do {
                let request: ProjectReview
                if let prepared { request = prepared }
                else { request = try await ProjectReview.prepare(changes: changes, selectedPaths: selected, context: context, focus: focus) }
                try Task.checkCancellation()
                prepared = request
                if start {
                    failure = model.startReview(row, provider: reviewer, request: request)
                    if failure == nil { dismiss() }
                } else { preview = true }
            } catch is CancellationError {} catch { failure = error.localizedDescription }
        }
    }
}
