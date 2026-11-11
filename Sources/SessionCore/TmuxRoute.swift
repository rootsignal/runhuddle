import Foundation

public struct TmuxRoute: Hashable {
    public let pane: String
    public let paneTTY: String
    public let session: String
    public let window: String
    public let cwd: String
    public let title: String
    public let serverPID: String
    public let clientTTY: String

    public static func targets(panes: String, clients: String, terminals: [TerminalTarget]) -> [TerminalTarget] {
        let clients = clients.split(separator: "\n").map { $0.split(separator: "\t", omittingEmptySubsequences: false).map(String.init) }.filter { $0.count == 2 }
        var result: [TerminalTarget] = []
        for line in panes.split(separator: "\n").prefix(500) {
            let row = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
            guard row.count == 7, valid(row[0], prefix: "%"), valid(row[2], prefix: "$"), valid(row[3], prefix: "@"),
                  Int32(row[6]).map({ $0 > 1 }) == true, row[1].hasPrefix("/dev/") else { continue }
            for client in clients where client[1] == row[2] {
                for terminal in terminals where !terminal.tty.isEmpty && terminal.tty == client[0] && terminal.tmux == nil {
                    let route = TmuxRoute(pane: row[0], paneTTY: row[1], session: row[2], window: row[3], cwd: row[4], title: row[5], serverPID: row[6], clientTTY: client[0])
                    result.append(TerminalTarget(app: terminal.app, window: terminal.window, identity: terminal.identity,
                                                 title: terminal.title, cwd: terminal.cwd, tty: terminal.tty,
                                                 applicationPID: terminal.applicationPID, tmux: route))
                }
            }
        }
        return Array(Set(result))
    }
    private static func valid(_ value: String, prefix: Character) -> Bool {
        value.first == prefix && value.count > 1 && value.dropFirst().allSatisfy { $0.isASCII && $0.isNumber }
    }
}
