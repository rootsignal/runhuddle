import Foundation

public enum PreferredTerminal: String, CaseIterable, Identifiable {
    case terminal, iterm2, ghostty
    public var id: String { rawValue }
    public var title: String {
        switch self { case .terminal: return "Terminal"; case .iterm2: return "iTerm2"; case .ghostty: return "Ghostty" }
    }
    public var bundleID: String {
        switch self {
        case .terminal: return "com.apple.Terminal"
        case .iterm2: return "com.googlecode.iterm2"
        case .ghostty: return "com.mitchellh.ghostty"
        }
    }
    public static func stored(_ value: String?) -> Self { Self(rawValue: value ?? "") ?? .terminal }
    public static func appleScriptLiteral(_ value: String) -> String {
        "\"" + value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n") + "\""
    }
    // Commands are supplied only at creation, never typed into an existing pane.
    public func creationScript(command: String, cwd: String, preferTab: Bool) -> String? {
        let shell = Self.appleScriptLiteral("/bin/zsh -lc " + ShellCommand.quote(command))
        let useTab = preferTab ? "true" : "false"
        switch self {
        case .terminal: return nil // Terminal.app uses the verified new-tab adapter.
        case .iterm2:
            return """
            tell application id "com.googlecode.iterm2"
                if \(useTab) and (count of windows) > 0 then
                    tell current window
                        create tab with default profile command \(shell)
                    end tell
                else
                    create window with default profile command \(shell)
                end if
                activate
            end tell
            """
        case .ghostty:
            return """
            tell application id "com.mitchellh.ghostty"
                set cfg to new surface configuration
                set initial working directory of cfg to \(Self.appleScriptLiteral(cwd))
                set command of cfg to \(shell)
                set wait after command of cfg to true
                if \(useTab) and (count of windows) > 0 then
                    new tab in front window with configuration cfg
                else
                    new window with configuration cfg
                end if
                activate
            end tell
            """
        }
    }
}
