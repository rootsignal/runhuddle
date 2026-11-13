import SwiftUI
import SessionCore

struct AgentPlanView: View {
    let plan: AgentPlan
    let sessionState: SessionState
    @ViewState private var expanded = false
    init(plan: AgentPlan, sessionState: SessionState, expanded: Bool = false) {
        self.plan = plan; self.sessionState = sessionState
        _expanded = ViewState(initialValue: expanded)
    }
    var body: some View {
        if !plan.steps.isEmpty {
            DisclosureGroup(isExpanded: $expanded) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(plan.steps.enumerated()), id: \.offset) { _, step in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: symbol(step.status))
                                .foregroundStyle(step.status == .blocked ? Color.orange : step.status == .completed ? Color.green : step.status == .inProgress ? HuddleStyle.accent : Color.secondary)
                                .accessibilityLabel(statusTitle(step.status))
                            Text(step.text).font(.caption).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if let date = plan.reportedDate {
                        Text("Updated \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption2).foregroundStyle(.secondary)
                    } else { Text("Update time unavailable").font(.caption2).foregroundStyle(.secondary) }
                    Text(plan.source + " · Agent-reported; results are not independently verified.")
                        .font(.caption2).foregroundStyle(.secondary)
                }.padding(.top, 8)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Agent checklist").font(.subheadline.bold())
                    Text(plan.countSummary).font(.caption).foregroundStyle(.secondary)
                    if plan.newerRequest {
                        Text("From an earlier request").font(.caption).foregroundStyle(.secondary)
                    } else if let step = plan.currentStep {
                        Text((sessionState == .working ? "Reported step: " : "Last reported step: ") + step.text)
                            .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
            }
        }
    }
    private func symbol(_ status: AgentPlan.Status) -> String {
        switch status { case .blocked: "exclamationmark.circle"; case .pending: "circle"; case .inProgress: "circle.inset.filled"; case .completed: "checkmark.circle.fill" }
    }
    private func statusTitle(_ status: AgentPlan.Status) -> String {
        switch status { case .blocked: "Blocked"; case .pending: "Pending"; case .inProgress: "Reported in progress"; case .completed: "Reported complete" }
    }
}
