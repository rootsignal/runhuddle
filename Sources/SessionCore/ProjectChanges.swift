import Foundation

/// Argument arrays only; inspection never runs hooks, external diff drivers or a shell.
public enum ProjectGit {
    public static func run(_ directory: String, _ arguments: [String], limit: Int = 4_000_000) throws -> Data {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", directory] + arguments
        process.environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("GIT_") }
            .merging(["GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"]) { _, new in new }
        process.standardInput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice; process.standardOutput = pipe
        try process.run()
        let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: timeout)
        defer { timeout.cancel() }
        var result = Data(), exceeded = false
        while let chunk = try pipe.fileHandleForReading.read(upToCount: 65536), !chunk.isEmpty {
            if result.count + chunk.count <= limit { result.append(chunk) }
            else { exceeded = true; if process.isRunning { process.terminate() } }
        }
        process.waitUntilExit()
        guard !exceeded else { throw failure("Output is too large to display. Open the project in your editor.") }
        guard process.terminationStatus == 0 else { throw failure("Git could not complete this request. Check that the folder is a readable repository and refresh.") }
        return result
    }
    public static func text(_ directory: String, _ arguments: [String]) throws -> String {
        String(decoding: try run(directory, arguments), as: UTF8.self).trimmingCharacters(in: .newlines)
    }
    public static func failure(_ text: String) -> NSError { NSError(domain: "ProjectGit", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}

public struct ProjectChangedFile: Identifiable, Equatable, Sendable {
    public var id: String { path }
    public let path: String
    public let original: String?
    public let status: String
    public var additions: String = "—"
    public var deletions: String = "—"
}

public struct ProjectChanges: Sendable {
    public let root: String
    public let branch: String
    public let revision: String
    public let upstream: String?
    public let ahead: Int?
    public let behind: Int?
    public let checkedAt: Date
    public let files: [ProjectChangedFile]
    public var syncSummary: String {
        guard let upstream, let ahead, let behind else { return "No upstream comparison available" }
        return "\(ahead) unpushed · \(behind) behind \(upstream) (local refs)"
    }
    public var handoffSnapshot: String {
        "Repository snapshot · \(checkedAt.ISO8601Format())\nFolder: \(root)\nBranch: \(branch)\nHEAD: \(revision)\n\(files.count) uncommitted files\n\(syncSummary)\nVerify this snapshot before acting; files and remote branches may have changed."
    }
    public static func parseStatus(_ data: Data) -> [ProjectChangedFile] {
        let parts = data.split(separator: 0); var result: [ProjectChangedFile] = [], index = 0
        while index < parts.count {
            let bytes = Array(parts[index]); index += 1
            guard bytes.count >= 4 else { continue }
            let status = String(decoding: bytes.prefix(2), as: UTF8.self)
            let path = String(decoding: bytes.dropFirst(3), as: UTF8.self)
            var original: String?
            if status.contains("R") || status.contains("C"), index < parts.count {
                original = String(decoding: parts[index], as: UTF8.self); index += 1
            }
            result.append(.init(path: path, original: original, status: status))
        }
        return result
    }
    public static func read(_ directory: String, includeLineCounts: Bool = true) async throws -> Self {
        try await Task.detached(priority: .utility) { try inspect(directory, includeLineCounts: includeLineCounts) }.value
    }
    private static func inspect(_ directory: String, includeLineCounts: Bool) throws -> Self {
        let root = try ProjectGit.text(directory, ["rev-parse", "--show-toplevel"])
        let revision = try? ProjectGit.text(root, ["rev-parse", "--verify", "HEAD"])
        let branch = (try? ProjectGit.text(root, ["symbolic-ref", "--quiet", "--short", "HEAD"])) ?? "Detached HEAD"
        let upstream = try? ProjectGit.text(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
        let counts = (try? ProjectGit.text(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]))?.split(whereSeparator: \.isWhitespace).compactMap { Int($0) }
        var files = parseStatus(try ProjectGit.run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
        if includeLineCounts {
        // Disable rename detection here so every stats record has one literal path.
        var args = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z"]
        args += revision == nil ? [try ProjectGit.text(root, ["hash-object", "-t", "tree", "/dev/null"])] : ["HEAD"]
        let stats = (try? ProjectGit.run(root, args)) ?? Data()
        var numbers: [String: (String, String)] = [:]
        for record in stats.split(separator: 0) {
            let parts = record.split(separator: 9, maxSplits: 2, omittingEmptySubsequences: false)
            if parts.count == 3 { numbers[String(decoding: parts[2], as: UTF8.self)] = (String(decoding: parts[0], as: UTF8.self), String(decoding: parts[1], as: UTF8.self)) }
        }
        for i in files.indices {
            if let counts = numbers[files[i].path] { files[i].additions = counts.0; files[i].deletions = counts.1 }
            if let original = files[i].original, let old = numbers[original] { files[i].deletions = old.1 }
            if i < 200, files[i].status == "??", let data = try? readFile(root, path: files[i].path), !data.contains(0) {
                files[i].additions = String(data.isEmpty ? 0 : data.split(separator: 10, omittingEmptySubsequences: false).count - (data.last == 10 ? 1 : 0)); files[i].deletions = "0"
            }
        }
        }
        return .init(root: root, branch: branch, revision: revision ?? "No commits yet", upstream: upstream,
                     ahead: counts?.first, behind: counts?.count == 2 ? counts?[1] : nil, checkedAt: Date(), files: files)
    }
    private static func readFile(_ root: String, path: String) throws -> Data {
        let base = URL(fileURLWithPath: root).resolvingSymlinksInPath()
        let url = base.appendingPathComponent(path).resolvingSymlinksInPath()
        guard url.path.hasPrefix(base.path + "/") else { throw ProjectGit.failure("This file points outside the project.") }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        let data = try handle.read(upToCount: 1_000_001) ?? Data()
        guard data.count <= 1_000_000 else { throw ProjectGit.failure("File is too large to preview. Open it in your editor.") }
        return data
    }
    public func diff(_ file: ProjectChangedFile) async throws -> String {
        try await Task.detached(priority: .utility) {
            if file.status == "??" {
                let data = try Self.readFile(root, path: file.path)
                guard !data.contains(0), let text = String(data: data, encoding: .utf8) else { return "Binary or non-UTF-8 file. Open in your editor to inspect." }
                var lines = text.components(separatedBy: "\n")
                if lines.last == "" { lines.removeLast() }
                let body = lines.map { "+" + $0 }.joined(separator: "\n")
                return "New untracked file: \(file.path)\n--- /dev/null\n+++ \(file.path)\n@@ -0,0 +1,\(lines.count) @@\n" + body
            }
            var args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=3"]
            args += revision == "No commits yet" ? [try ProjectGit.text(root, ["hash-object", "-t", "tree", "/dev/null"])] : ["HEAD"]
            let paths = [file.path] + (file.original.map { [$0] } ?? [])
            let text = try ProjectGit.text(root, args + ["--"] + paths)
            return text.isEmpty ? "No net textual diff against HEAD. Staged and unstaged changes may cancel out, or this entry may be a submodule." : text
        }.value
    }
}
