import SwiftUI
import SessionCore

/// Compact current repository state for the session’s working directory.
struct RepositoryContextView: View {
    let context: RepositoryContext?
    let loading: Bool
    var directory: String = ""
    let refresh: () -> Void
    let openChanges: () -> Void
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
                    Button(context.changedFiles == 0 ? "View changes · clean" : "\(context.changedFiles) changed…") { openChanges() }
                        .font(.caption).buttonStyle(.plain).foregroundStyle(HuddleStyle.accent)
                }
                if context.linkedWorktree { Text("Linked worktree").font(.caption).foregroundStyle(.secondary) }
                if context.root != directory {
                    Text("Root: " + context.root).font(.caption).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("Checked \(context.checkedAt, style: .relative) ago")
                    .font(.caption).foregroundStyle(.secondary)
            } else if loading {
                ProgressView("Reading repository…").controlSize(.small)
            } else {
                Text("No repository information available.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            // Attribution and counting details are available without occupying panel space.
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(HuddleStyle.raised.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
            .help("Current repository state, including untracked files. Changes may come from any session or editor.")
    }
}
