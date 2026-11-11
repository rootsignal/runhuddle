import Foundation

public struct AttentionRequest: Codable, Hashable, Sendable {
    public var kind: String
    public var detail: String?
    public var since: Double?
    public init(kind: String = "input", detail: String? = nil, since: Double? = nil) {
        self.kind = kind; self.detail = detail; self.since = since
    }
    public var title: String {
        switch kind {
        case "permission": return "Permission requested"
        case "question": return "Question waiting"
        case "plan": return "Plan review"
        case "error": return "Agent needs attention"
        default: return "Input requested"
        }
    }
    public static func reconcile(_ current: Session, previous: Session?, now: Double) -> AttentionRequest? {
        guard current.state == .needsInput else { return nil }
        var request = current.attention ?? AttentionRequest()
        if request.since == nil {
            request.since = previous?.state == .needsInput ? previous?.attention?.since ?? now : now
        }
        return request
    }
}
