import Foundation
import CSQLite

public final class Store {
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    public init(path: String) throws {
        guard sqlite3_open(path, &db) == SQLITE_OK else { throw failure() }
        try execute("PRAGMA journal_mode=WAL;")
        try execute("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value BLOB NOT NULL);")
    }
    deinit { sqlite3_close(db) }
    private func failure() -> NSError {
        NSError(domain: "SessionStore", code: 1, userInfo: [NSLocalizedDescriptionKey: db.map { String(cString: sqlite3_errmsg($0)) } ?? "Cannot open session database"])
    }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
    }
    public func save<T: Encodable>(_ value: T, key: String) throws {
        let data = try JSONEncoder().encode(value)
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO records(key,value) VALUES(?,?)", -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, transient)
        _ = data.withUnsafeBytes { sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32(data.count), transient) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw failure() }
    }
    public func load<T: Decodable>(_ type: T.Type, key: String) throws -> T? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT value FROM records WHERE key=?", -1, &statement, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, key, -1, transient)
        let result = sqlite3_step(statement)
        if result == SQLITE_DONE { return nil }
        guard result == SQLITE_ROW, let bytes = sqlite3_column_blob(statement, 0) else { throw failure() }
        return try JSONDecoder().decode(type, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 0))))
    }
}
