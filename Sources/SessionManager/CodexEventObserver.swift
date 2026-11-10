import Foundation

/// The helper's output is a bounded stream of invalidations, not conversation contents.
@MainActor final class CodexEventObserver {
    private var process: Process?
    private var output: Pipe?
    private var pending = Data()
    private var connected = false
    private var restart: Task<Void, Never>?
    private let changed: () -> Void
    init(changed: @escaping () -> Void) { self.changed = changed }

    func start() {
        guard process == nil else { return }
        let task = Process(), pipe = Pipe()
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("python/bin/python3").path
        task.executableURL = URL(fileURLWithPath: bundled.flatMap { FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil }
            ?? FileManager.default.currentDirectoryPath + "/.venv/bin/python")
        task.arguments = ["-E", "-s", "-B", Bridge.root + "/codex_events.py"]
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }
            Task { @MainActor [weak self] in self?.receive(bytes) }
        }
        task.terminationHandler = { [weak self, weak task] _ in
            Task { @MainActor [weak self] in
                guard let self, let task, self.process === task else { return }
                task.terminationHandler = nil
                self.output?.fileHandleForReading.readabilityHandler = nil
                self.output = nil; self.process = nil; self.pending = Data()
                if self.connected { self.connected = false; self.changed() }
                self.restart = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(30))
                    if !Task.isCancelled { self?.start() }
                }
            }
        }
        do { try task.run(); process = task; output = pipe }
        catch {
            pipe.fileHandleForReading.readabilityHandler = nil
            restart = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                if !Task.isCancelled { self?.start() }
            }
        }
    }
    private func receive(_ data: Data) {
        pending.append(data)
        guard pending.count < 65536 else { pending = Data(); return }
        while let end = pending.firstIndex(of: 10) {
            let line = pending[..<end]; pending.removeSubrange(...end)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: String] else { continue }
            switch value["type"] {
            case "connected": connected = true; changed()
            case "changed": changed()
            case "disconnected":
                if connected { connected = false; changed() }
            default: break
            }
        }
    }
    func stop() {
        restart?.cancel(); restart = nil
        output?.fileHandleForReading.readabilityHandler = nil
        process?.terminationHandler = nil
        if process?.isRunning == true { process?.terminate() }
        process = nil; output = nil
    }
}
