import Foundation

public struct AgentPlan: Codable, Hashable, Sendable {
    public struct Step: Codable, Hashable, Sendable, Identifiable {
        public let id: String
        public let text: String
        public let status: Status
    }
    public enum Status: String, Codable, Sendable { case pending, inProgress, completed, blocked }
    public let steps: [Step]
    public let source: String
    public let reportedAt: String
    public let newerRequest: Bool
    public var completedCount: Int { steps.filter { $0.status == .completed }.count }
    public var currentStep: Step? { steps.first { $0.status == .inProgress } }
    public var countSummary: String { "\(completedCount) of \(steps.count) steps reported complete" }
    public var reportedDate: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: reportedAt) ?? ISO8601DateFormatter().date(from: reportedAt)
    }
}
