import SwiftUI
import SessionCore

struct RepositoryContextView: View {
    let directory: String
    @ViewState private var context: RepositoryContext?
    @ViewState private var loading = false
    @ViewState private var unavailable = false
    @ViewState private var refreshID = UUID()

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("Repository").font(.system(size: 13, weight: .semibold))
                Spacer()
                if loading { ProgressView().controlSize(.mini) }
                Button { refreshID = UUID() } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).disabled(loading).help("Refresh repository context")
                    .accessibilityLabel("Refresh repository context")
            }
            if let context {
                Label(context.branch, systemImage: "arrow.triangle.branch")
                    .font(.callout).textSelection(.enabled)
                HStack {
                    Text(context.changedFiles == 0 ? "Working tree clean" : "\(context.changedFiles) changed \(context.changedFiles == 1 ? "file" : "files")")
                    Spacer()
                    Text(context.linkedWorktree ? "Linked worktree" : "Main worktree")
                }.font(.caption).foregroundStyle(.secondary)
                Text(context.root).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(2).truncationMode(.middle).textSelection(.enabled).help(context.root)
                Text("Checked \(context.checkedAt, style: .relative) ago · includes untracked files")
                    .font(.caption2).foregroundStyle(.secondary)
            } else if unavailable {
                Text("Repository unavailable. This folder may be missing, inaccessible, or outside a Git worktree.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Reading repository…").font(.caption).foregroundStyle(.secondary)
            }
            Text("Shared repository state, not changes attributed to this session.")
                .font(.caption2).foregroundStyle(.secondary)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(HuddleStyle.raised.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
            .task(id: directory + refreshID.uuidString) {
                loading = true
                context = nil
                unavailable = false
                do {
                    let result = try await RepositoryContext.read(at: directory)
                    guard !Task.isCancelled else { return }
                    context = result
                } catch {
                    guard !Task.isCancelled else { return }
                    unavailable = true
                }
                loading = false
            }
    }
}
