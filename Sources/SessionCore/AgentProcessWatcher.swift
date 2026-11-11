import Foundation

/// Process exits invalidate provider status; they never directly mark a session closed.
/// In particular, Codex can have multiple CLI clients sharing one server-side session.
@MainActor public final class AgentProcessWatcher {
    private var sources: [Int32: DispatchSourceProcess] = [:]
    private var providers: [Int32: String] = [:]
    private let changed: (String) -> Void
    public init(changed: @escaping (String) -> Void) { self.changed = changed }

    nonisolated public static func terminalProcesses(_ output: String) -> [Int32: String] {
        var result: [Int32: String] = [:]
        for line in output.split(separator: "\n") {
            let fields = line.split(maxSplits: 2, whereSeparator: { $0.isWhitespace })
            guard fields.count == 3, let pid = Int32(fields[0]), pid > 1,
                  fields[1] != "??", fields[1] != "?" else { continue }
            let name = URL(fileURLWithPath: String(fields[2])).lastPathComponent
            if let provider = ["codex": "Codex", "claude": "Claude", "copilot": "Copilot", "copilot-cli": "Copilot"][name] {
                result[pid] = provider
            }
        }
        return result
    }

    public func update(_ processes: [Int32: String]) {
        for pid in Array(sources.keys) where processes[pid] != providers[pid] {
            sources.removeValue(forKey: pid)?.cancel()
            if let provider = providers.removeValue(forKey: pid) { changed(provider) }
        }
        for (pid, provider) in processes where pid > 1 && sources[pid] == nil {
            let source = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
            sources[pid] = source; providers[pid] = provider
            source.setEventHandler { [weak self] in
                guard let self else { return }
                self.sources.removeValue(forKey: pid)?.cancel()
                self.providers.removeValue(forKey: pid)
                self.changed(provider)
            }
            source.resume()
        }
    }
    public func stop() {
        for source in sources.values { source.cancel() }
        sources.removeAll(); providers.removeAll()
    }
    deinit { for source in sources.values { source.cancel() } }
}
