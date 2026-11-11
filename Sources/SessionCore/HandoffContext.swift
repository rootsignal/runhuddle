import Foundation

public struct ConversationMessage: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let role: String
    public let text: String
    public init(id: String, role: String, text: String) { self.id = id; self.role = role; self.text = text }
}

public struct HandoffContext: Codable, Sendable {
    public let messages: [ConversationMessage]?
    public let text: String
    public let updated: Date
    public let latestRequest: String?
    public let latestResponse: String?
    public let sessionUpdated: Double?
    public init(text: String, updated: Date = Date(), latestRequest: String? = nil, latestResponse: String? = nil, sessionUpdated: Double? = nil, messages: [ConversationMessage]? = nil) {
        self.messages = messages
        self.latestRequest = latestRequest; self.latestResponse = latestResponse; self.sessionUpdated = sessionUpdated
        self.text = text
        self.updated = updated
    }
    public static func compose(notes: String, context: HandoffContext?, failure: String?) -> String {
        var result = notes
        if let failure {
            result += "\n\n> Recorded context could not be refreshed. " + (context == nil ? "No recorded context is available." : "Using cached context.") + " " + failure
        }
        if let context {
            result += "\n\n## Recorded continuation context\nRetrieved: \(context.updated.ISO8601Format())\n\n" + context.text
        }
        return result
    }
}
