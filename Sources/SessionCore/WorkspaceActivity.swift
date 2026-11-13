import Foundation

/// Report other conversations without treating an idle agent as concurrent work.
public struct WorkspaceActivity: Equatable, Sendable {
    public let working: Int
    public let waiting: Int
    public let idle: Int

    public init(sessions: [Session], directory: String, excluding sourceID: String) {
        let key = ProjectPreferences.key(directory)
        let others = sessions.filter { !$0.simulated && $0.id != sourceID && ProjectPreferences.key($0.cwd) == key }
        working = others.filter { $0.state == .working }.count
        waiting = others.filter { $0.state == .needsInput }.count
        idle = others.filter { $0.state == .idle }.count
    }
}
