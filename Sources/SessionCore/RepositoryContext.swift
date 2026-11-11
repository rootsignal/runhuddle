import Foundation

public struct RepositoryContext: Equatable, Sendable {
    public let root: String
    public let branch: String
    public let linkedWorktree: Bool
    public let changedFiles: Int
    public let checkedAt: Date

    public static func read(at directory: String) async throws -> Self {
        try await Task.detached(priority: .utility) { try inspect(directory) }.value
    }

    // Porcelain -z treats a rename as one entry followed by its original path.
    // NUL delimiters preserve filenames containing tabs, newlines, or quotes.
    public static func changedFileCount(_ data: Data) -> Int {
        let entries = data.split(separator: 0)
        var index = 0, count = 0
        while index < entries.count {
            let entry = entries[index]
            guard entry.count >= 3 else { index += 1; continue }
            let status = Array(entry.prefix(2))
            count += 1
            index += (status.contains(82) || status.contains(67)) ? 2 : 1
        }
        return count
    }

    private static func inspect(_ directory: String) throws -> Self {
        guard directory.hasPrefix("/") else { throw failure() }
        func git(_ args: [String]) throws -> Data {
            let process = Process(), pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
            process.arguments = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", directory] + args
            // Inspect the selected directory, independent of the app launch shell.
            process.environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("GIT_") }
                .merging(["GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"]) { _, new in new }
            process.standardOutput = pipe
            process.standardError = FileHandle.nullDevice
            process.standardInput = FileHandle.nullDevice
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 5, execute: timeout)
            defer { timeout.cancel() }
            let output = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw failure() }
            return output
        }
        func string(_ args: [String]) throws -> String {
            String(decoding: try git(args), as: UTF8.self).trimmingCharacters(in: .newlines)
        }
        let root = try string(["rev-parse", "--show-toplevel"])
        let gitDir = try string(["rev-parse", "--absolute-git-dir"])
        let common = try string(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        let branch: String
        if let named = try? string(["symbolic-ref", "--quiet", "--short", "HEAD"]) { branch = named }
        else { branch = "Detached HEAD · " + (try string(["rev-parse", "--short", "HEAD"])) }
        let status = try git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"])
        return Self(root: root, branch: branch, linkedWorktree: gitDir != common,
                    changedFiles: changedFileCount(status), checkedAt: Date())
    }
    private static func failure() -> NSError {
        NSError(domain: "RepositoryContext", code: 1, userInfo: [NSLocalizedDescriptionKey: "Repository unavailable. The folder may be missing, inaccessible, or outside a Git worktree."])
    }
}
