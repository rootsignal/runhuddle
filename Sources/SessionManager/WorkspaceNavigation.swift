import SwiftUI

/// Compact navigation shared by the full workspace and narrow-window layouts.
struct WorkspaceNavigation: View {
    let selection: String
    let count: (String) -> Int
    let select: (String) -> Void
    let returnToSessions: () -> Void
    private let filters = [("Running here", "Active"), ("All sessions", "All"), ("Pinned", "Pinned"), ("Archived", "Archived")]
    private var tabs: some View {
        Picker("Workspace", selection: Binding(get: { selection == "Saved work" ? "Saved work" : "Sessions" }, set: {
            if $0 == "Sessions" { returnToSessions() } else { select("Saved work") }
        })) {
            Text("Sessions").tag("Sessions")
            Text("Notes").tag("Saved work")
        }.pickerStyle(.segmented).labelsHidden().frame(width: 210)
    }
    private var sessionFilters: some View {
        HStack(spacing: 4) {
            ForEach(filters, id: \.0) { key, title in
                Button { select(key) } label: {
                    HStack(spacing: 5) {
                        Text(title)
                        Text("\(count(key))").monospacedDigit().foregroundStyle(.secondary)
                    }.font(.system(size: 12, weight: selection == key ? .semibold : .regular))
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(selection == key ? HuddleStyle.accent.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
                    .foregroundStyle(selection == key ? HuddleStyle.accent : .secondary)
                    .accessibilityLabel(title).accessibilityValue("\(count(key)) items")
                    .accessibilityAddTraits(selection == key ? .isSelected : [])
            }
        }.fixedSize(horizontal: true, vertical: false)
    }
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 16) {
                tabs
                if selection != "Saved work" { sessionFilters }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 8) {
                tabs
                if selection != "Saved work" {
                    ScrollView(.horizontal) { sessionFilters }.scrollIndicators(.hidden)
                }
            }
        }.padding(.horizontal, 16).padding(.vertical, 10)
    }
}
