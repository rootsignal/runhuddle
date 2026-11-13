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
            HStack(alignment: .top, spacing: 8) {
                ContextUsageIndicator(fraction: 0.65)
                Text("Context used · last reported estimate").font(.caption).foregroundStyle(.secondary)
            }
            entry("arrow.triangle.2.circlepath", "Compactions", "Count observed in available history or tracking hooks. Earlier events may be missing.")
            Text("Compaction counts appear only above zero; no count may mean unavailable data.")
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
