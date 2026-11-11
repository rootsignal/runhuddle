import Foundation
import CryptoKit

public struct GeneratedHandoff: Codable, Sendable {
    public let text: String
    public let provider: String
    public let generatedAt: Date
    public let sessionUpdated: Double
    public let sourceFingerprint: String
    public init(text: String, provider: String, generatedAt: Date = Date(), sessionUpdated: Double, sourceFingerprint: String) {
        self.text = text; self.provider = provider; self.generatedAt = generatedAt
        self.sessionUpdated = sessionUpdated; self.sourceFingerprint = sourceFingerprint
    }
    public static func fingerprint(context: String, purpose: String, nextStep: String) -> String {
        let data = try! JSONEncoder().encode([context, purpose, nextStep])
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    public func isStale(sessionUpdated: Double, fingerprint: String) -> Bool {
        sessionUpdated > self.sessionUpdated || fingerprint != sourceFingerprint
    }
    public static func visibleText(draft: String?, generated: GeneratedHandoff?) -> String {
        guard let generated else { return "" }
        return draft ?? generated.text
    }
    public func hasEdits(_ draft: String) -> Bool { draft != text }
}
