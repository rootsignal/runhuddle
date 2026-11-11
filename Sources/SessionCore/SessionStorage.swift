import Foundation

public struct SessionStorage: Codable, Hashable, Sendable {
    public let bytes: Int64
    public let allocatedBytes: Int64
    public let fileID: String
    public let checkedAt: Double

    public init(bytes: Int64, allocatedBytes: Int64, fileID: String, checkedAt: Double) {
        self.bytes = bytes; self.allocatedBytes = allocatedBytes
        self.fileID = fileID; self.checkedAt = checkedAt
    }
    public static func formatted(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}

public struct SessionStorageTotal {
    public let allocatedBytes: Int64
    public let unavailable: Int
    public let measured: Int
    public init(_ sessions: [Session]) {
        var files = Set<String>(), total: Int64 = 0, missing = 0, known = 0
        for session in sessions {
            guard let storage = session.storage else { missing += 1; continue }
            known += 1
            if files.insert(storage.fileID).inserted { total += max(0, storage.allocatedBytes) }
        }
        allocatedBytes = total; unavailable = missing; measured = known
    }
    public var label: String {
        guard measured > 0 else { return "Transcript storage unavailable" }
        let size = SessionStorage.formatted(allocatedBytes) + " of transcripts on disk"
        return unavailable == 0 ? size : size + " · \(unavailable) unavailable"
    }
}
