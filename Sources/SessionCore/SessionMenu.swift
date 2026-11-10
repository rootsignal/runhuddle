import Foundation

public struct SessionMenu {
    public let needsInput: [Session]
    public let working: [Session]
    public let idle: [Session]
    public let recentlyFinished: [Session]
    public var summary: String {
        "\(working.count) working · \(needsInput.count) need input · \(idle.count) idle"
    }
    public init(sessions: [Session], alerts: [SessionAlert]) {
        let real = sessions.filter { !$0.simulated }.sorted {
            $0.updated == $1.updated ? $0.id < $1.id : $0.updated > $1.updated
        }
        needsInput = real.filter { $0.state == .needsInput }
        working = real.filter { $0.state == .working }
        idle = real.filter { $0.state == .idle }
        let currentIdle = Dictionary(idle.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var seen: Set<String> = []
        recentlyFinished = Array(alerts.filter { $0.kind == .finished }.compactMap {
            guard seen.insert($0.session.id).inserted else { return nil as Session? }
            return currentIdle[$0.session.id]
        }.prefix(3))
    }
}
