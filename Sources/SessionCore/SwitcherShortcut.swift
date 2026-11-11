import Foundation

public struct SwitcherShortcut: Codable, Equatable {
    public var keyCode: UInt32
    public var modifiers: UInt32
    public var label: String
    // Carbon modifier values: control + option, physical space key.
    public static let standard = SwitcherShortcut(keyCode: 49, modifiers: 4096 | 2048, label: "⌃⌥Space")
    public init(keyCode: UInt32, modifiers: UInt32, label: String) {
        self.keyCode = keyCode; self.modifiers = modifiers; self.label = label
    }
    public var valid: Bool {
        keyCode <= 127 && keyCode != 53 && !label.isEmpty &&
        modifiers & (256 | 2048 | 4096) != 0 && modifiers & ~UInt32(256 | 512 | 2048 | 4096) == 0
    }
}
