import SwiftUI
import AppKit
import SessionCore

struct ProjectChangesView: View {
    let directory: String
    var review: ((Set<String>?) -> Void)? = nil
    @EnvironmentObject private var model: AppModel
    @ViewState private var changes: ProjectChanges?
    @ViewState private var selected: String?
    @ViewState private var query = ""
    @ViewState private var diff = "Select a file to inspect its changes."
    @ViewState private var failure: String?
    @ViewState private var loading = false
    @ViewState private var refreshID = UUID()
    private var files: [ProjectChangedFile] {
        (changes?.files ?? []).filter { query.isEmpty || $0.path.localizedCaseInsensitiveContains(query) }
    }
    private func status(_ file: ProjectChangedFile) -> String {
        if file.status == "??" { return "Untracked" }
        if file.status.contains("U") || ["AA", "DD"].contains(file.status) { return "Conflict" }
        if file.status.contains("R") { return "Renamed" }
        if file.status.contains("D") { return "Deleted" }
        if file.status.contains("A") { return "Added" }
        return "Modified"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(URL(fileURLWithPath: changes?.root ?? directory).lastPathComponent).font(.headline)
                    Text(changes?.root ?? directory).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle).help(directory)
                }
                Spacer()
                if let review {
                    Menu("Review…") {
                        Button("All changes with an agent…") { review(nil) }
                        Button("Selected file with an agent…") { if let selected { review([selected]) } }.disabled(selected == nil)
                    }.disabled(changes?.files.isEmpty != false || loading)
                }
                Button { refreshID = UUID() } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(loading).help("Refresh project changes").accessibilityLabel("Refresh project changes")
            }
            if loading { ProgressView("Reading changes…").controlSize(.small) }
            if let failure { Text(failure).font(.caption).foregroundStyle(.orange) }
            if let changes {
                ViewThatFits(in: .horizontal) {
                    HStack { repositoryStatus(changes); Spacer(); commitStatus(changes) }
                    VStack(alignment: .leading, spacing: 4) { repositoryStatus(changes); commitStatus(changes) }
                }
                HSplitView {
                    VStack(spacing: 6) {
                        TextField("Filter files", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 6)
                        List(files, selection: $selected) { file in
                            VStack(alignment: .leading, spacing: 3) {
                                Text((file.path as NSString).lastPathComponent).foregroundStyle(.primary).font(.callout).lineLimit(1).truncationMode(.middle)
                                let folder = (file.path as NSString).deletingLastPathComponent
                                if !folder.isEmpty { Text(folder).font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle) }
                                HStack(spacing: 6) {
                                    Text(status(file)).foregroundStyle(.secondary)
                                    Spacer(minLength: 0)
                                    Text("+\(file.additions)").foregroundStyle(.green)
                                    Text("−\(file.deletions)").foregroundStyle(.red)
                                }.font(.caption2.monospacedDigit())
                            }.padding(.vertical, 2).tag(file.id).help(file.path + " · " + status(file))
                        }.listStyle(.sidebar)
                        if files.isEmpty { Text(query.isEmpty ? "No changed files" : "No matching files").font(.caption).foregroundStyle(.secondary).padding(8) }
                    }.frame(minWidth: 140, idealWidth: 200, maxWidth: 260)
                    VStack(alignment: .leading, spacing: 8) {
                        if let file = changes.files.first(where: { $0.id == selected }) {
                            HStack {
                                Text(file.path).lineLimit(1).truncationMode(.middle).help(file.path)
                                Spacer(minLength: 4)
                                Button { open(file, root: changes.root) } label: { Image(systemName: "arrow.up.forward.app") }
                                    .help("Open file in preferred editor").accessibilityLabel("Open file in preferred editor")
                                    .disabled(file.status.contains("D"))
                            }.font(.caption)
                        }
                        ProjectDiffText(text: diff, highlightsDiff: true).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }.padding(.leading, 8).frame(minWidth: 200)
                }
                HStack {
                    Text("Shared project changes · Read-only")
                    Spacer()
                    Text("Checked \(changes.checkedAt, style: .relative) ago")
                }.font(.caption2).foregroundStyle(.secondary)
                    .help("Changes may come from multiple sessions or editors. Line numbers show old and new positions. A dash in counts means binary or unavailable data.")
            }
        }.padding(10).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: refreshID) {
            loading = true; failure = nil
            do {
                let value = try await ProjectChanges.read(directory)
                guard !Task.isCancelled else { return }
                changes = value
                if !value.files.contains(where: { $0.id == selected }) { selected = value.files.first?.id }
                if value.files.isEmpty { diff = "No uncommitted changes." }
            } catch { if !Task.isCancelled { failure = error.localizedDescription } }
            loading = false
        }
        .task(id: (selected ?? "") + String(changes?.checkedAt.timeIntervalSince1970 ?? 0)) {
            guard let changes, let selected, let file = changes.files.first(where: { $0.id == selected }) else { return }
            diff = "Loading diff…"
            do { let text = try await changes.diff(file); if !Task.isCancelled { diff = text } }
            catch { if !Task.isCancelled { diff = error.localizedDescription } }
        }
    }
    private func repositoryStatus(_ changes: ProjectChanges) -> some View {
        HStack(spacing: 8) {
            Label(changes.branch, systemImage: "arrow.triangle.branch").lineLimit(1)
            Text("\(changes.files.count) uncommitted files").fontWeight(.medium)
        }.font(.caption).help("Uncommitted changes are not included in pushed commits.")
    }
    private func commitStatus(_ changes: ProjectChanges) -> some View {
        Text(changes.ahead.map { "\($0) unpushed commits · \(changes.behind ?? 0) behind" } ?? "No upstream comparison")
            .font(.caption).foregroundStyle(.secondary)
            .help(changes.syncSummary + ". Based on local references; no network fetch performed.")
    }
    private func open(_ file: ProjectChangedFile, root: String) {
        ProjectEditorPreferences.shared.openFile(path: URL(fileURLWithPath: root).appendingPathComponent(file.path).path, project: directory) {
            if let error = $0 { model.error = error }
        }
    }
}

struct ProjectDiffText: NSViewRepresentable {
    let text: String
    var highlightsDiff = false
    class Coordinator { var renderedText: String?; var highlighted = false }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = true
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 500, height: 400))
        view.isEditable = false; view.isSelectable = true
        view.isVerticallyResizable = true; view.isHorizontallyResizable = true
        view.autoresizingMask = [.width]
        view.minSize = .zero; view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.textContainer?.widthTracksTextView = false
        view.textContainer?.containerSize = view.maxSize
        view.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        view.backgroundColor = .textBackgroundColor; view.textColor = .textColor
        view.textContainerInset = NSSize(width: 8, height: 8)
        scroll.documentView = view
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? NSTextView,
              context.coordinator.renderedText != text || context.coordinator.highlighted != highlightsDiff else { return }
        context.coordinator.renderedText = text; context.coordinator.highlighted = highlightsDiff
        if highlightsDiff {
            let result = NSMutableAttributedString()
            let lines = UnifiedDiffLine.parse(text)
            let largest = lines.reduce(0) { max($0, $1.oldLine ?? 0, $1.newLine ?? 0) }
            let numberWidth = max(2, String(largest).count)
            for line in lines {
                let color: NSColor
                switch line.kind {
                case .addition: color = .systemGreen
                case .deletion: color = .systemRed
                case .hunk: color = .systemBlue
                case .header: color = .secondaryLabelColor
                case .context: color = .textColor
                }
                func column(_ number: Int?) -> String {
                    let value = number.map(String.init) ?? ""
                    return String(repeating: " ", count: max(0, numberWidth - value.count)) + value
                }
                let numbers = column(line.oldLine) + " " + column(line.newLine) + " │ "
                result.append(NSAttributedString(string: numbers, attributes: [.foregroundColor: NSColor.secondaryLabelColor]))
                result.append(NSAttributedString(string: line.text + "\n", attributes: [.foregroundColor: color]))
            }
            result.addAttribute(.font, value: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular), range: NSRange(location: 0, length: result.length))
            view.textStorage?.setAttributedString(result)
        } else { view.string = text }
        view.scrollRangeToVisible(NSRange(location: 0, length: 0))
    }
}
