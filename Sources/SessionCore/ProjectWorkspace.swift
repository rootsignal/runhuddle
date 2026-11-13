import Foundation

public enum ProjectWorkspace {
    public static func destination(directory: String, suffix: String) -> String {
        let url = URL(fileURLWithPath: directory).standardizedFileURL
        return url.deletingLastPathComponent().appendingPathComponent(url.lastPathComponent + "-" + suffix).path
    }
    public static func create(directory: String, branch: String, destination: String) async throws -> String {
        try await Task.detached(priority: .utility) {
            guard destination.hasPrefix("/"), !FileManager.default.fileExists(atPath: destination) else { throw ProjectGit.failure("Choose a new, empty workspace path.") }
            _ = try ProjectGit.run(directory, ["check-ref-format", "--branch", branch])
            guard (try? ProjectGit.run(directory, ["rev-parse", "--verify", "HEAD"])) != nil else { throw ProjectGit.failure("An isolated workspace needs an existing commit. Commit the initial project first, or use the current folder.") }
            _ = try ProjectGit.run(directory, ["worktree", "add", "-b", branch, "--", destination, "HEAD"])
            return destination
        }.value
    }
}
