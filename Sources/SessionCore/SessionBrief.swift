import Foundation

public struct SessionBrief: Codable {
    public var purpose: String
    public var nextStep: String
    public init(purpose: String = "", nextStep: String = "") {
        self.purpose = purpose; self.nextStep = nextStep
    }
}

public struct HistoryMatch: Decodable, Identifiable {
    public let id: String
    public let role: String
    public let excerpt: String
}
