import SwiftUI

/// Compact navigation shared by the full workspace and narrow-window layouts.
struct WorkspaceNavigation: View {
    let selection: String
    let select: (String) -> Void
    let returnToSessions: () -> Void
    private var tabs: some View {
        Picker("Workspace", selection: Binding(get: { selection == "Saved work" ? "Saved work" : "Sessions" }, set: {
            if $0 == "Sessions" { returnToSessions() } else { select("Saved work") }
        })) {
            Text("Sessions").tag("Sessions")
            Text("Notes").tag("Saved work")
        }.pickerStyle(.segmented).labelsHidden().frame(width: 210)
    }
    var body: some View {
        HStack { tabs; Spacer(minLength: 0) }
            .padding(.horizontal, 16).padding(.vertical, 10)
    }
}

struct SessionScopeNavigation: View {
    let selection: String
    let count: (String) -> Int
    let select: (String) -> Void
    private let filters = [("Running here", "Active"), ("All sessions", "All"), ("Pinned", "Pinned"), ("Archived", "Archived")]
    var body: some View {
        ViewThatFits(in: .horizontal) {
            buttons(showCounts: true)
            buttons(showCounts: false)
        }
    }
    private func buttons(showCounts: Bool) -> some View {
        HStack(spacing: 2) {
            ForEach(filters, id: \.0) { key, title in
                Button { select(key) } label: {
                    HStack(spacing: 5) {
                        Text(title).lineLimit(1)
                        if showCounts { Text("\(count(key))").monospacedDigit().foregroundStyle(.secondary) }
                    }.font(.system(size: 12, weight: selection == key ? .semibold : .regular))
                        .padding(.horizontal, 4).padding(.vertical, 7)
                        .background(selection == key ? HuddleStyle.accent.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .foregroundStyle(selection == key ? HuddleStyle.accent : .secondary)
                    .accessibilityLabel(title).accessibilityValue("\(count(key)) items")
                    .accessibilityAddTraits(selection == key ? .isSelected : [])
            }
        }.fixedSize(horizontal: true, vertical: false)
    }
}
