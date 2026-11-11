import SwiftUI
import SessionCore

struct RepositoryContextView: View {
    let directory: String
    @ViewState private var context: RepositoryContext?
    @ViewState private var loading = false
    @ViewState private var unavailable = false
    @ViewState private var refreshID = UUID()

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let context {
                    Label(context.branch, systemImage: "arrow.triangle.branch")
                        .font(.system(size: 12, weight: .medium)).lineLimit(1).truncationMode(.middle)
                        .help(context.branch)
                    Spacer(minLength: 4)
                    Text(context.changedFiles == 0 ? "Clean" : "\(context.changedFiles) changed")
                        .font(.caption).foregroundStyle(.secondary).fixedSize()
                } else {
                    Text(unavailable ? "Repository unavailable" : "Reading repository…")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                if loading { ProgressView().controlSize(.mini) }
                Button { refreshID = UUID() } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).disabled(loading).help("Refresh repository context")
                    .accessibilityLabel("Refresh repository context")
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 6) {
                    if let context {
                        Text(context.root).textSelection(.enabled)
                        Text("Checked \(context.checkedAt, style: .relative) ago · includes untracked files")
                    } else {
                        Text("This folder may be missing, inaccessible, or outside a Git worktree.")
                    }
                    Text("Shared repository state, not changes attributed to this session.")
                }.font(.caption2).foregroundStyle(.secondary).padding(.top, 4)
            } label: {
                Text(context.map { ($0.linkedWorktree ? "Linked worktree" : "Main worktree") + " · shared state" } ?? "Repository details")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
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
