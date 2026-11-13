import Foundation

public struct UnifiedDiffLine: Equatable {
    public enum Kind { case context, addition, deletion, header, hunk }
    public let text: String
    public let oldLine: Int?
    public let newLine: Int?
    public let kind: Kind

    public static func parse(_ text: String) -> [Self] {
        let expression = try! NSRegularExpression(pattern: #"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@"#)
        var old: Int?, new: Int?
        return text.components(separatedBy: "\n").map { line in
            if let match = expression.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
               let a = Range(match.range(at: 1), in: line), let b = Range(match.range(at: 2), in: line) {
                old = Int(line[a]); new = Int(line[b])
                return Self(text: line, oldLine: nil, newLine: nil, kind: .hunk)
            }
            if line.hasPrefix("diff --git ") { old = nil; new = nil }
            if old != nil && new != nil {
                if line.hasPrefix("+") {
                    defer { new! += 1 }
                    return Self(text: line, oldLine: nil, newLine: new, kind: .addition)
                }
                if line.hasPrefix("-") {
                    defer { old! += 1 }
                    return Self(text: line, oldLine: old, newLine: nil, kind: .deletion)
                }
                if line.hasPrefix(" ") {
                    defer { old! += 1; new! += 1 }
                    return Self(text: line, oldLine: old, newLine: new, kind: .context)
                }
            }
            return Self(text: line, oldLine: nil, newLine: nil, kind: .header)
        }
    }
}
