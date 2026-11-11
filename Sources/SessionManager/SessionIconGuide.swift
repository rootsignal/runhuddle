import SwiftUI

struct SessionIconGuide: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            entry("hand.raised.fill", "Needs input", "The agent is waiting for you.", color: .orange)
            entry("bolt.fill", "Working", "The agent reports work in progress.", color: .blue)
            entry("checkmark.circle", "Idle", "Ready for another prompt.", color: .green)
            entry("archivebox", "Previous session", "History is available; live activity is not confirmed.")
            entry("archivebox.fill", "Archived", "Kept out of your main session lists.")
            Divider()
            entry("circle.dotted", "Context %", "Last reported context usage, when available.")
            entry("arrow.triangle.2.circlepath", "Compactions", "Count observed in available history or tracking hooks. Earlier events may be missing.")
            entry("doc.text.fill", "Handoff ready", "A generated handoff is available.", color: HuddleStyle.accent)
            entry("doc.badge.clock", "Review handoff", "New activity since generation, or a replacement awaits review. Hover for details.", color: .orange)
            entry("books.vertical.fill", "Work saved", "One or more independent records are saved in Library. Hover for the count; later session activity may not be included.", color: HuddleStyle.accent)
            Text("No handoff icon means none has been generated. Compaction counts appear only above zero; no count may mean unavailable data.")
                .font(.caption2).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func entry(_ icon: String, _ title: String, _ description: String, color: Color = .secondary) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).foregroundStyle(color).frame(width: 16)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.caption.weight(.medium)).foregroundStyle(.primary)
                Text(description).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }.accessibilityElement(children: .combine)
    }
}
