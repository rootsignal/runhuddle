import SwiftUI
import SessionCore

struct AttentionRequestCard: View {
    let row: Session
    var review: (() -> Void)? = nil
    var navigating = false
    @ViewState private var expanded = false
    private var request: AttentionRequest { row.attention ?? AttentionRequest() }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(request.title, systemImage: "hand.raised.fill").font(.headline).foregroundStyle(.orange)
            if let since = request.since {
                Text("Waiting since \(Date(timeIntervalSince1970: since), style: .time)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let detail = request.detail, !detail.isEmpty {
                if expanded {
                    ScrollView { Text(detail).font(.callout).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: 160)
                } else { Text(detail).font(.callout).lineLimit(3).textSelection(.enabled) }
                Button(expanded ? "Show less" : "Read full request") { expanded.toggle() }.buttonStyle(.plain).font(.caption)
            } else {
                Text("The agent reports that input is needed. Open its terminal to see the full request.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if let review {
                Button(action: review) {
                    HStack(spacing: 8) {
                        if navigating { ProgressView().controlSize(.small) }
                        else { Image(systemName: "terminal") }
                        Text(navigating ? "Finding terminal…" : "Review in Terminal")
                    }.frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                    .disabled(navigating || row.simulated)
                    .help("Open this session’s terminal to review and answer the request")
                Text("Answer there to continue. Any follow-up draft stays saved here.")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Continue in the terminal to answer this request.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(12)
            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }
}
