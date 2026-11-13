import AppKit
import SwiftUI

struct TerminalTheme {
    let background: String
    let canvas: String
    let panel: String
    let raised: String
    let accent: String
    let selection: String
    let selectionText: String
    let cursor: String
    let dark: Bool
    let ansi: [String]
    var foreground: String? = nil
    var cursorText: String? = nil

    static func named(_ name: String, dark: Bool) -> TerminalTheme {
        let resolved = name == "Follow app" ? (dark ? "Slate" : "Paper") : name
        switch resolved {
        case "Dracula": return .init(background: "282A36", canvas: "21222C", panel: "282A36", raised: "44475A", accent: "BD93F9", selection: "44475A", selectionText: "F8F8F2", cursor: "F8F8F2", dark: true,
            ansi: ["21222C", "FF5555", "50FA7B", "F1FA8C", "BD93F9", "FF79C6", "8BE9FD", "F8F8F2", "6272A4", "FF6E6E", "69FF94", "FFFFA5", "D6ACFF", "FF92DF", "A4FFFF", "FFFFFF"], foreground: "F8F8F2")
        case "Nord": return .init(background: "2E3440", canvas: "2E3440", panel: "3B4252", raised: "434C5E", accent: "88C0D0", selection: "4C566A", selectionText: "D8DEE9", cursor: "D8DEE9", dark: true,
            ansi: ["3B4252", "BF616A", "A3BE8C", "EBCB8B", "81A1C1", "B48EAD", "88C0D0", "E5E9F0", "4C566A", "BF616A", "A3BE8C", "EBCB8B", "81A1C1", "B48EAD", "8FBCBB", "ECEFF4"], foreground: "D8DEE9")
        case "Catppuccin Mocha": return .init(background: "1E1E2E", canvas: "181825", panel: "1E1E2E", raised: "313244", accent: "CBA6F7", selection: "353749", selectionText: "CDD6F4", cursor: "F5E0DC", dark: true,
            ansi: ["45475A", "F38BA8", "A6E3A1", "F9E2AF", "89B4FA", "F5C2E7", "94E2D5", "A6ADC8", "585B70", "F38BA8", "A6E3A1", "F9E2AF", "89B4FA", "F5C2E7", "94E2D5", "BAC2DE"], foreground: "CDD6F4", cursorText: "11111B")
        case "Solarized Light": return .init(background: "FDF6E3", canvas: "EEE8D5", panel: "FDF6E3", raised: "EEE8D5", accent: "586E75", selection: "EEE8D5", selectionText: "586E75", cursor: "586E75", dark: false,
            ansi: ["EEE8D5", "DC322F", "859900", "B58900", "268BD2", "D33682", "2AA198", "073642", "FDF6E3", "CB4B16", "93A1A1", "839496", "657B83", "6C71C4", "586E75", "002B36"], foreground: "657B83")

        case "Dusk": return .init(background: "2D2933", canvas: "211E27", panel: "292530", raised: "38313F", accent: "C6ACE4", selection: "51425F", selectionText: "F4EDF9", cursor: "DCC4ED", dark: true,
            ansi: ["393140", "D990A0", "ACC59E", "DCC095", "A6B5DF", "C5A3D8", "9BC7C5", "D0C7D6", "5C5065", "EFAABB", "C0D7B4", "EBD4AE", "BDCBEE", "DABBEA", "B5DDDA", "EEE8F2"])
        case "Midnight": return .init(background: "10141B", canvas: "0C1016", panel: "151B25", raised: "202A38", accent: "8CBDEB", selection: "2B4664", selectionText: "F0F6FC", cursor: "9ACBFA", dark: true,
            ansi: ["202B3A", "E59198", "A2CBA7", "E2C68E", "87B8EB", "C3A6DF", "89C9D2", "CED8E4", "4A5668", "F1ABB0", "BCE0BF", "F0DBAD", "AED1F6", "D9C0EF", "A7E0E6", "EFF5FB"])
        case "Paper": return .init(background: "F3F4F6", canvas: "ECEEF2", panel: "FAFBFC", raised: "E3E7ED", accent: "285F88", selection: "CADDED", selectionText: "182D40", cursor: "285F88", dark: false,
            ansi: ["303640", "99424D", "456C3B", "785B22", "355F91", "72508D", "326B71", "69717D", "5C6572", "A64B56", "4D7443", "826225", "406A9C", "805D99", "3E777C", "252D38"])
        case "Warm": return .init(background: "F3EDE2", canvas: "EAE2D5", panel: "FAF5EB", raised: "E4D9C9", accent: "77552F", selection: "DDC8A9", selectionText: "382C20", cursor: "77552F", dark: false,
            ansi: ["3D352D", "93483F", "4C673F", "77571D", "45617C", "775573", "376A65", "73685B", "776959", "A04D44", "567144", "805D24", "4D6B8A", "85607F", "40756D", "302920"])
        default: return .init(background: "242A32", canvas: "181D25", panel: "202630", raised: "2D3540", accent: "8DC8D1", selection: "3D5264", selectionText: "F1F5F8", cursor: "ABD8DF", dark: true,
            ansi: ["303640", "D58D94", "A5BD98", "D4BC8B", "92AECF", "B5A1C8", "91BEC2", "C5CBD3", "4C5666", "E2A2A8", "B6CBAA", "E1CCA2", "A9C0DE", "C7B5D6", "A8CFD1", "E1E5EB"])
        }
    }
}

extension TerminalOptionsPreference {
    static var stored: Self {
        UserDefaults.standard.data(forKey: "embeddedTerminalPreferences")
            .flatMap { try? JSONDecoder().decode(Self.self, from: $0) } ?? Self()
    }
    func preset(dark: Bool) -> TerminalTheme { TerminalTheme.named(theme, dark: dark) }
    func appColorScheme(appearance: String) -> ColorScheme? {
        if coordinateApp && theme != "Follow app" { return preset(dark: true).dark ? .dark : .light }
        switch appearance { case "dark": return .dark; case "light": return .light; default: return nil }
    }
    func cursorColors(dark: Bool) -> (NSColor, NSColor) {
        (Self.color(customCursor ?? preset(dark: dark).cursor), Self.color(customCursorText ?? preset(dark: dark).cursorText ?? preset(dark: dark).background))
    }
    func selectionColors(dark: Bool) -> (NSColor, NSColor) {
        (Self.color(customSelection ?? preset(dark: dark).selection), Self.color(customSelectionText ?? preset(dark: dark).selectionText))
    }
    mutating func selectTheme(_ name: String) {
        theme = name
        resetColorOverrides()
        contrast = preset(dark: true).foreground == nil ? 0.45 : 0.5
        saturation = preset(dark: true).foreground == nil ? 0.60 : 1.0
    }
    var themeDescription: String {
        switch theme {
        case "Dracula": return "Dracula · vivid colors on a purple-gray background"
        case "Nord": return "Nord · cool blue-gray surfaces and restrained colors"
        case "Catppuccin Mocha": return "Catppuccin Mocha · soft pastel colors on a dark base"
        case "Solarized Light": return "Solarized Light · warm light background with the original Solarized palette"
        default: return "RunHuddle preset · adjustable contrast and color intensity"
        }
    }
    mutating func resetColorOverrides() {
        customBackground = nil; customForeground = nil; customCursor = nil; customCursorText = nil
        customSelection = nil; customSelectionText = nil; customAccent = nil; ansiOverrides = [:]
    }
}

struct SavedTerminalTheme: Codable, Identifiable {
    var id = UUID()
    var name: String
    var options: TerminalOptionsPreference
}
