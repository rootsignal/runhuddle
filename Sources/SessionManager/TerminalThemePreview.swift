import AppKit
import SwiftUI
import SwiftTerm

extension TerminalOptionsPreference {
    func applyColors(to terminal: TerminalView, dark: Bool) {
        terminal.getTerminal().ansi256PaletteStrategy = .xterm
        let base = colors(dark: dark), selection = selectionColors(dark: dark), cursor = cursorColors(dark: dark)
        terminal.nativeBackgroundColor = base.0
        terminal.nativeForegroundColor = base.1
        terminal.caretColor = cursor.0
        terminal.caretTextColor = cursor.1
        terminal.selectedTextBackgroundColor = selection.0
        terminal.selectedTextForegroundColor = selection.1
        terminal.installColors(ansiColors(dark: dark))
        // SwiftTerm's non-bright path also shifts extended indices down by 8.
        // Keep standard indices intact; users can customize the bright palette.
        terminal.useBrightColors = true
    }
}

/// An isolated emulator, with no process, input forwarding, or agent session.
struct TerminalThemePreview: NSViewRepresentable {
    let options: TerminalOptionsPreference
    let dark: Bool
    var transcript: String? = nil
    func makeNSView(context: Context) -> TerminalView {
        TerminalView(frame: NSRect(x: 0, y: 0, width: 560, height: 280))
    }
    func updateNSView(_ terminal: TerminalView, context: Context) {
        terminal.font = options.resolvedFont
        options.applyColors(to: terminal, dark: dark)
        terminal.getTerminal().setCursorStyle(CursorStyle(tagName: options.cursor) ?? .steadyBlock)
        terminal.feed(text: "\u{1b}[0m\u{1b}[2J\u{1b}[H" + (transcript ?? Self.sample))
    }
    static let sample = """
    \u{1b}[1mRunHuddle · theme preview\u{1b}[0m\r
    \u{1b}[48;5;8m ❯ Review the latest changes \u{1b}[0m\r
    \u{1b}[32m✓ Tests passed\u{1b}[0m  \u{1b}[33m! Warning\u{1b}[0m  \u{1b}[31m✕ Error\u{1b}[0m\r
    \u{1b}[34mlet\u{1b}[0m theme = \u{1b}[35m"Your workspace"\u{1b}[0m\r
    \u{1b}[2mDim text · supporting information\u{1b}[0m\r
    \u{1b}[90mBright gray\u{1b}[0m  \u{1b}[96mCyan\u{1b}[0m  \u{1b}[95mMagenta\u{1b}[0m\r
    \u{1b}[38;2;230;145;175mAgent RGB: stays pink\u{1b}[0m\r
    \u{1b}[48;2;58;67;80m\u{1b}[38;2;235;239;245m Agent RGB background \u{1b}[0m\r
    Drag across text to test selection.\r
    ❯
    """
}

struct TerminalColorEditor: View {
    @Binding var options: TerminalOptionsPreference
    let dark: Bool
    private let names = ["Black / prompt background", "Red", "Green", "Yellow", "Blue", "Magenta", "Cyan", "White", "Bright black / gray", "Bright red", "Bright green", "Bright yellow", "Bright blue", "Bright magenta", "Bright cyan", "Bright white"]
    var body: some View {
        DisclosureGroup("Custom colors") {
            VStack(alignment: .leading, spacing: 10) {
                color("Background", key: \.customBackground, fallback: options.colors(dark: dark).0)
                color("Text", key: \.customForeground, fallback: options.colors(dark: dark).1)
                color("Cursor", key: \.customCursor, fallback: options.cursorColors(dark: dark).0)
                color("Text beneath cursor", key: \.customCursorText, fallback: options.cursorColors(dark: dark).1)
                color("Selection background", key: \.customSelection, fallback: options.selectionColors(dark: dark).0)
                color("Selected text", key: \.customSelectionText, fallback: options.selectionColors(dark: dark).1)
                if let ratio = contrastRatio {
                    Text(String(format: "Text/background contrast: %.1f:1", ratio)).font(.caption).foregroundStyle(.secondary)
                    if ratio < 4.5 { Text("This combination may be hard to read. Try a lighter text color or a darker background—or the reverse for a light theme.").font(.caption).foregroundStyle(.orange) }
                }
                DisclosureGroup("Standard terminal palette (16 colors)") {
                    ForEach(0..<16, id: \.self) { index in
                        HStack {
                            ColorPicker(names[index], selection: Binding(get: { Color(nsColor: options.palette(dark: dark)[index]) }, set: { options.ansiOverrides[String(index)] = TerminalOptionsPreference.hex(NSColor($0)) }), supportsOpacity: false)
                            Button { options.ansiOverrides.removeValue(forKey: String(index)) } label: { Image(systemName: "arrow.uturn.backward") }
                                .disabled(options.ansiOverrides[String(index)] == nil).help("Reset " + names[index])
                                .accessibilityLabel("Reset " + names[index])
                        }
                    }
                }
                Button("Reset all color overrides") { options.resetColorOverrides() }
                Text("Custom text replaces the contrast slider. Palette edits do not alter explicit RGB colors sent by agents.").font(.caption).foregroundStyle(.secondary)
            }.padding(.top, 8)
        }
    }
    private func color(_ name: String, key: WritableKeyPath<TerminalOptionsPreference, String?>, fallback: NSColor) -> some View {
        HStack {
            ColorPicker(name, selection: Binding(get: { Color(nsColor: options[keyPath: key].map(TerminalOptionsPreference.color) ?? fallback) }, set: { options[keyPath: key] = TerminalOptionsPreference.hex(NSColor($0)) }), supportsOpacity: false)
            Button { options[keyPath: key] = nil } label: { Image(systemName: "arrow.uturn.backward") }
                .disabled(options[keyPath: key] == nil).help("Reset " + name).accessibilityLabel("Reset " + name)
        }
    }
    private var contrastRatio: Double? {
        let pair = options.colors(dark: dark)
        func luminance(_ c: NSColor) -> Double {
            guard let rgb = c.usingColorSpace(.sRGB) else { return 0 }
            func linear(_ x: CGFloat) -> Double { x <= 0.04045 ? Double(x) / 12.92 : pow((Double(x) + 0.055) / 1.055, 2.4) }
            return 0.2126 * linear(rgb.redComponent) + 0.7152 * linear(rgb.greenComponent) + 0.0722 * linear(rgb.blueComponent)
        }
        let a = luminance(pair.0), b = luminance(pair.1)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}
