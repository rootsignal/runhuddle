import SwiftUI
import SessionCore

struct AttentionRequestCard: View {
    let row: Session
    @ViewState private var expanded = false
    private var request: AttentionRequest { row.attention ?? AttentionRequest() }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(request.title).font(.headline).foregroundStyle(.orange)
            if let since = request.since {
                Text("Observed waiting since \(Date(timeIntervalSince1970: since), style: .time)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let detail = request.detail, !detail.isEmpty {
                if expanded {
                    ScrollView { Text(detail).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 160)
                } else { Text(detail).font(.callout).lineLimit(3).textSelection(.enabled) }
                Button(expanded ? "Show less" : "Show recorded request") { expanded.toggle() }.buttonStyle(.plain).font(.caption)
            } else {
                Text("The agent reports that input is needed. Open its terminal to see the full request.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Text("Answer in the terminal. RunHuddle does not approve or send a response.")
                .font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }
}
