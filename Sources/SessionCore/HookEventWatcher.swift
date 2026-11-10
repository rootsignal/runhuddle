import Foundation
import Darwin

/// Watches hook-written signal files, never database contents read by snapshots.
/// Parent watches reattach after atomic replacement or deletion/recreation.
public final class HookEventWatcher {
    private let paths: [String: String]
    private let changed: (Set<String>) -> Void
    private var files: [String: (fd: Int32, source: DispatchSourceFileSystemObject)] = [:]
    private var directories: [DispatchSourceFileSystemObject] = []
    public init(paths: [String: String], changed: @escaping (Set<String>) -> Void) {
        self.paths = paths; self.changed = changed
    }
    @discardableResult public func start() -> Bool {
        guard directories.isEmpty else { return true }
        let roots = Set(paths.keys.map { URL(fileURLWithPath: $0).deletingLastPathComponent().path })
        for root in roots {
            try? FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
            let fd = open(root, O_EVTONLY)
            guard fd >= 0 else { continue }
            let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: .main)
            source.setEventHandler { [weak self] in self?.reconcile(notify: true) }
            source.setCancelHandler { close(fd) }
            directories.append(source); source.resume()
        }
        for path in paths.keys where !FileManager.default.fileExists(atPath: path) {
            // Tracker-owned, content-free marker. Exclusive creation cannot truncate a hook write.
            let fd = open(path, O_CREAT | O_EXCL | O_WRONLY, 0o600)
            if fd >= 0 { close(fd) }
        }
        reconcile(notify: false)
        return !directories.isEmpty && files.count == paths.count
    }
    private func reconcile(notify: Bool) {
        var affected = Set<String>()
        for (path, provider) in paths {
            var current = stat(), attached = stat()
            let exists = stat(path, &current) == 0
            if let old = files[path], exists, fstat(old.fd, &attached) == 0,
               current.st_dev == attached.st_dev, current.st_ino == attached.st_ino { continue }
            let wasAttached = files[path] != nil
            files.removeValue(forKey: path)?.source.cancel()
            let fd = open(path, O_EVTONLY)
            if fd >= 0 {
                let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .attrib, .rename, .delete, .revoke], queue: .main)
                source.setEventHandler { [weak self] in
                    self?.changed([provider])
                    self?.reconcile(notify: false)
                }
                source.setCancelHandler { close(fd) }
                files[path] = (fd, source); source.resume()
            }
            if notify && (wasAttached || fd >= 0) { affected.insert(provider) }
        }
        if !affected.isEmpty { changed(affected) }
    }
    public func stop() {
        for entry in files.values { entry.source.cancel() }
        for source in directories { source.cancel() }
        files.removeAll(); directories.removeAll()
    }
    deinit { stop() }
}
