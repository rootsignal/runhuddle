import SwiftUI
import SessionCore

/// Uses the same snapshot as the compact header; switching tabs does not re-run Git.
struct RepositoryContextView: View {
    let context: RepositoryContext?
    let loading: Bool
    let refresh: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Repository", systemImage: "arrow.triangle.branch").font(.headline)
                Spacer()
                Button(action: refresh) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(QuietIconButtonStyle()).disabled(loading)
                    .help("Refresh repository context").accessibilityLabel("Refresh repository context")
            }
            if let context {
                HStack {
                    Text(context.branch).font(.callout.weight(.medium)).textSelection(.enabled)
                    Spacer()
                    Text(context.changedFiles == 0 ? "Clean" : "\(context.changedFiles) changed")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text(context.linkedWorktree ? "Linked worktree" : "Main worktree").font(.caption)
                Text(context.root).font(.caption).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Checked \(context.checkedAt, style: .relative) ago · includes untracked files")
                    .font(.caption).foregroundStyle(.secondary)
            } else if loading {
                ProgressView("Reading repository…").controlSize(.small)
            } else {
                Text("Repository unavailable. The folder may be missing, inaccessible, or outside a Git worktree.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Text("Shared repository state, not changes attributed to this session.")
                .font(.caption).foregroundStyle(.secondary)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(HuddleStyle.raised.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
    }
}
