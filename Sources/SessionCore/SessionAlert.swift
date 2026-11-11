import Foundation

public struct SessionAlert: Identifiable, Sendable {
    public enum Kind: String, Sendable { case input, finished }
    public let session: Session
    public let kind: Kind
    public init(session: Session, kind: Kind) { self.session = session; self.kind = kind }
    public var id: String { session.id + ":" + kind.rawValue }
    public var title: String { kind == .input ? "\(session.provider) needs input" : "\(session.provider) is ready for review" }
    public static func transitions(from previous: [Session], to current: [Session]) -> [SessionAlert] {
        let old = Dictionary(previous.map { ($0.id, $0.state) }, uniquingKeysWith: { _, last in last })
        return current.compactMap { row in
            guard !row.simulated, let before = old[row.id], before != .disconnected else { return nil }
            if row.state == .needsInput && before != .needsInput { return SessionAlert(session: row, kind: .input) }
            if row.state == .idle && before == .working { return SessionAlert(session: row, kind: .finished) }
            return nil
        }
    }
}
