import AppKit
import SwiftUI
import SwiftTerm
import SessionCore

struct TerminalOptionsPreference: Codable, Equatable {
    var font = "Menlo"
    var size = 13.0
    var theme = "Follow app"
    var cursor = "steadyBlock"
    var scrollback = 10000
    var optionAsMeta = false

    var contrast = 0.45
    var saturation = 0.60
    var customBackground: String?
    var customForeground: String?

    var coordinateApp = false
    var customCursor: String?
    var customCursorText: String?
    var customSelection: String?
    var customSelectionText: String?
    var customAccent: String?
    var ansiOverrides: [String: String] = [:]

    enum CodingKeys: String, CodingKey { case font, size, theme, cursor, scrollback, optionAsMeta, contrast, saturation, customBackground, customForeground, coordinateApp, customCursor, customCursorText, customSelection, customSelectionText, customAccent, ansiOverrides }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        font = try c.decodeIfPresent(String.self, forKey: .font) ?? "Menlo"
        size = try c.decodeIfPresent(Double.self, forKey: .size) ?? 13
        theme = try c.decodeIfPresent(String.self, forKey: .theme) ?? "Follow app"
        cursor = try c.decodeIfPresent(String.self, forKey: .cursor) ?? "steadyBlock"
        scrollback = try c.decodeIfPresent(Int.self, forKey: .scrollback) ?? 10000
        optionAsMeta = try c.decodeIfPresent(Bool.self, forKey: .optionAsMeta) ?? false
        contrast = try c.decodeIfPresent(Double.self, forKey: .contrast) ?? 0.45
        saturation = try c.decodeIfPresent(Double.self, forKey: .saturation) ?? 0.60
        customBackground = try c.decodeIfPresent(String.self, forKey: .customBackground)
        customForeground = try c.decodeIfPresent(String.self, forKey: .customForeground)
        coordinateApp = try c.decodeIfPresent(Bool.self, forKey: .coordinateApp) ?? false
        customCursor = try c.decodeIfPresent(String.self, forKey: .customCursor)
        customCursorText = try c.decodeIfPresent(String.self, forKey: .customCursorText)
        customSelection = try c.decodeIfPresent(String.self, forKey: .customSelection)
        customSelectionText = try c.decodeIfPresent(String.self, forKey: .customSelectionText)
        customAccent = try c.decodeIfPresent(String.self, forKey: .customAccent)
        ansiOverrides = try c.decodeIfPresent([String: String].self, forKey: .ansiOverrides) ?? [:]
    }
    static let themes = ["Follow app", "Dracula", "Nord", "Catppuccin Mocha", "Solarized Light", "Slate", "Dusk", "Midnight", "Paper", "Warm"]
    var resolvedFont: NSFont { NSFont(name: font, size: min(32, max(9, size))) ?? .monospacedSystemFont(ofSize: min(32, max(9, size)), weight: .regular) }
    static func color(_ hex: String) -> NSColor {
        let value = UInt32(hex, radix: 16) ?? 0
        return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
    static func hex(_ color: NSColor) -> String {
        let rgb = color.usingColorSpace(.sRGB) ?? .black
        return String(format: "%02X%02X%02X", Int((rgb.redComponent * 255).rounded()), Int((rgb.greenComponent * 255).rounded()), Int((rgb.blueComponent * 255).rounded()))
    }
    func colors(dark: Bool) -> (NSColor, NSColor) {
        let background = Self.color(customBackground ?? preset(dark: dark).background)
        let rgb = background.usingColorSpace(.sRGB)!
        let isDark = (rgb.redComponent + rgb.greenComponent + rgb.blueComponent) / 3 < 0.5
        let amount = min(1, max(0, contrast))
        let low = Self.color(isDark ? "AFB7C1" : "59616C")
        let high = Self.color(isDark ? "F1F3F5" : "18212B")
        let reference = preset(dark: dark).foreground.map(Self.color)
        let adjusted: NSColor
        if let reference {
            adjusted = amount < 0.5
                ? reference.blended(withFraction: (0.5 - amount) * 0.20, of: background)!
                : reference.blended(withFraction: (amount - 0.5) * 0.30, of: isDark ? .white : .black)!
        } else { adjusted = low.blended(withFraction: amount, of: high)! }
        let foreground = customForeground.map(Self.color) ?? adjusted
        return (background, foreground)
    }
    func palette(dark: Bool) -> [NSColor] {
        return preset(dark: dark).ansi.enumerated().map { index, hex in
            if let override = ansiOverrides[String(index)] { return Self.color(override) }
            let color = Self.color(hex).usingColorSpace(.sRGB)!
            let gray = 0.2126 * color.redComponent + 0.7152 * color.greenComponent + 0.0722 * color.blueComponent
            return NSColor(srgbRed: gray, green: gray, blue: gray, alpha: 1)
                .blended(withFraction: min(1, max(0, saturation)), of: color)!
        }
    }
    func ansiColors(dark: Bool) -> [SwiftTerm.Color] {
        palette(dark: dark).map {
            let c = $0.usingColorSpace(.sRGB)!
            return SwiftTerm.Color(red: UInt16((c.redComponent * 65535).rounded()), green: UInt16((c.greenComponent * 65535).rounded()), blue: UInt16((c.blueComponent * 65535).rounded()))
        }
    }

}

@MainActor final class TerminalPreferences: ObservableObject {
    static let shared = TerminalPreferences()
    @Published var savedThemes: [SavedTerminalTheme] {
        didSet { if let data = try? JSONEncoder().encode(savedThemes) { UserDefaults.standard.set(data, forKey: "savedTerminalThemes") } }
    }
    func applySavedTheme(_ options: TerminalOptionsPreference) {
        let matching = value.coordinateApp
        let scrollback = value.scrollback
        let optionAsMeta = value.optionAsMeta
        value = options
        value.coordinateApp = matching
        value.scrollback = scrollback
        value.optionAsMeta = optionAsMeta
    }
    func resetAppearance() {
        let old = value
        value = TerminalOptionsPreference()
        value.scrollback = old.scrollback; value.optionAsMeta = old.optionAsMeta
        value.coordinateApp = old.coordinateApp
    }
    func saveTheme(named name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if let index = savedThemes.firstIndex(where: { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame }) {
            savedThemes[index].options = value
        } else { savedThemes.append(SavedTerminalTheme(name: trimmed, options: value)) }
    }
    @Published var value: TerminalOptionsPreference {
        didSet { if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: "embeddedTerminalPreferences") } }
    }
    init() {
        savedThemes = UserDefaults.standard.data(forKey: "savedTerminalThemes").flatMap { try? JSONDecoder().decode([SavedTerminalTheme].self, from: $0) } ?? []
        value = UserDefaults.standard.data(forKey: "embeddedTerminalPreferences").flatMap { try? JSONDecoder().decode(TerminalOptionsPreference.self, from: $0) } ?? TerminalOptionsPreference()
        // Matching was automatic in 0.25.0. Make it a deliberate opt-in once.
        if !UserDefaults.standard.bool(forKey: "independentAppearanceMigration1") {
            value.coordinateApp = false
            if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: "embeddedTerminalPreferences") }
            UserDefaults.standard.set(true, forKey: "independentAppearanceMigration1")
        }
    }
}

struct EmbeddedTerminalSettings: View {
    @ObservedObject private var preferences = TerminalPreferences.shared
    @Environment(\.colorScheme) private var scheme
    @ViewState private var themeName = ""
    private var fonts: [String] {
        Array(Set(NSFontManager.shared.availableFonts.filter {
            NSFont(name: $0, size: 13)?.isFixedPitch == true
        } + [preferences.value.font, "Menlo", "Monaco"])).sorted()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Terminal", systemImage: "terminal").font(.title2.bold())
            Text("Changes apply to open terminals. Agent settings and permissions stay with the agent.")
                .font(.caption).foregroundStyle(.secondary)
            Picker("Font", selection: $preferences.value.font) {
                ForEach(fonts, id: \.self) { Text($0).tag($0) }
            }
            Text("⌘+ / ⌘− to resize text · ⌘0 to reset").font(.caption).foregroundStyle(.secondary)
            Stepper("Size: \(Int(preferences.value.size)) pt", value: $preferences.value.size, in: 9...32)
            Picker("Colors", selection: Binding(get: { preferences.value.theme }, set: { preferences.value.selectTheme($0) })) {
                ForEach(TerminalOptionsPreference.themes, id: \.self) { Text($0).tag($0) }
            }
            Text(preferences.value.themeDescription).font(.caption).foregroundStyle(.secondary)
            Button("Restore this preset’s colors") { preferences.value.selectTheme(preferences.value.theme) }
            VStack(alignment: .leading, spacing: 6) {
                Text("Text contrast").font(.caption)
                Slider(value: $preferences.value.contrast, in: 0...1) { Text("Text contrast") } minimumValueLabel: { Text("Softer") } maximumValueLabel: { Text("Stronger") }
                    .labelsHidden()
                    .disabled(preferences.value.customForeground != nil)
                Text("Color intensity").font(.caption)
                Slider(value: $preferences.value.saturation, in: 0...1) { Text("Color intensity") } minimumValueLabel: { Text("Muted") } maximumValueLabel: { Text("Colorful") }
                    .labelsHidden()
            }
            TerminalThemePreview(options: preferences.value, dark: scheme == .dark)
                .frame(height: 280).clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityLabel("Live terminal theme preview")
            Text("Real terminal rendering: prompt, code, dim text, ANSI colors, and explicit RGB colors. Drag across text to preview selection. No agent is started.")
                .font(.caption).foregroundStyle(.secondary)
            TerminalColorEditor(options: $preferences.value, dark: scheme == .dark)
            DisclosureGroup("Saved themes") {
                HStack {
                    TextField("Theme name", text: $themeName).textFieldStyle(.roundedBorder)
                    Button(preferences.savedThemes.contains(where: { $0.name.caseInsensitiveCompare(themeName.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame }) ? "Update" : "Save") {
                        preferences.saveTheme(named: themeName); themeName = ""
                    }.disabled(themeName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Text("Saves terminal colors, font, and cursor. Updating a name replaces that saved theme.").font(.caption).foregroundStyle(.secondary)
                ForEach(preferences.savedThemes) { saved in
                    HStack {
                        Text(saved.name).lineLimit(1)
                        Spacer()
                        Button("Apply") { preferences.applySavedTheme(saved.options) }
                        Button { preferences.savedThemes.removeAll { $0.id == saved.id } } label: { Image(systemName: "trash") }
                            .help("Delete saved theme").accessibilityLabel("Delete theme " + saved.name)
                    }
                }
            }
            Text("Color intensity changes the standard palette only. Explicit RGB colors from agents are preserved, as shown by the RGB sample above. Custom palette colors override the intensity slider.")
                .font(.caption).foregroundStyle(.secondary)
            Picker("Cursor", selection: $preferences.value.cursor) {
                ForEach(CursorStyle.allCases, id: \.tagName) { Text($0.displayName).tag($0.tagName) }
            }
            Text("Agents can change the cursor shape while running.").font(.caption).foregroundStyle(.secondary)
            DisclosureGroup("Theme credits") {
                Link("Dracula", destination: URL(string: "https://draculatheme.com/alacritty")!)
                Link("Nord", destination: URL(string: "https://www.nordtheme.com")!)
                Link("Catppuccin", destination: URL(string: "https://github.com/catppuccin/ghostty")!)
                Link("Solarized · Ethan Schoonover", destination: URL(string: "https://ethanschoonover.com/solarized/")!)
                Text("Published terminal palettes, with RunHuddle workspace adaptations. License notices are included in the app.").font(.caption).foregroundStyle(.secondary)
            }
            Button("Restore terminal appearance defaults") { preferences.resetAppearance() }
        }
    }
}

@MainActor final class HuddleTerminalView: LocalProcessTerminalView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL, .png, .tiff] + NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) })
    }
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        registerForDraggedTypes([.fileURL, .png, .tiff] + NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) })
    }
    private func attachmentFolder() throws -> URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RunHuddle/Terminal Attachments", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return folder
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard process.running, sender.draggingSourceOperationMask.contains(.copy) else { return [] }
        let board = sender.draggingPasteboard
        return board.canReadObject(forClasses: [NSURL.self, NSImage.self, NSFilePromiseReceiver.self], options: [.urlReadingFileURLsOnly: true]) ? .copy : []
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { draggingEntered(sender) }
    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { !draggingEntered(sender).isEmpty }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard process.running else { return false }
        let board = sender.draggingPasteboard
        // The floating macOS screenshot thumbnail can promise a file that does
        // not exist yet. Receive it before inserting its path into the terminal.
        if let receivers = board.readObjects(forClasses: [NSFilePromiseReceiver.self], options: nil) as? [NSFilePromiseReceiver], !receivers.isEmpty {
            do {
                let folder = try attachmentFolder().appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                for receiver in receivers {
                    receiver.receivePromisedFiles(atDestination: folder, options: [:], operationQueue: .main) { [weak self] url, error in
                        Task { @MainActor [weak self] in
                            guard let self, self.process.running else { return }
                            guard error == nil else { NSSound.beep(); return }
                            self.pasteReference(ShellCommand.quote(url.path) + " ")
                        }
                    }
                }
                window?.makeFirstResponder(self)
                return true
            } catch { NSSound.beep(); return false }
        }
        let accepted = pasteAttachment(from: board, trailingSpace: true)
        if accepted { window?.makeFirstResponder(self) }
        return accepted
    }
    @discardableResult private func pasteReference(_ text: String) -> Bool {
        guard !text.contains("\n"), !text.contains("\r"), !text.contains("\u{1b}") else { NSSound.beep(); return false }
        let bracketed = getTerminal().bracketedPasteMode
        send(txt: (bracketed ? "\u{1b}[200~" : "") + text + (bracketed ? "\u{1b}[201~" : ""))
        return true
    }
    override func paste(_ sender: Any) {
        let board = NSPasteboard.general
        if board.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) ||
            (board.string(forType: .string) == nil && NSImage(pasteboard: board) != nil) {
            pasteAttachment(from: board)
        } else { super.paste(sender) }
    }
    @discardableResult func pasteAttachment(from pasteboard: NSPasteboard, trailingSpace: Bool = false) -> Bool {
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            return pasteReference(urls.map { ShellCommand.quote($0.path) }.joined(separator: " ") + (trailingSpace ? " " : ""))
        }
        if trailingSpace || pasteboard.string(forType: .string) == nil, let image = NSImage(pasteboard: pasteboard),
           let data = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data),
           let png = bitmap.representation(using: .png, properties: [:]) {
            do {
                let folder = try attachmentFolder()
                let file = folder.appendingPathComponent(UUID().uuidString + ".png")
                try png.write(to: file, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
                return pasteReference(ShellCommand.quote(file.path) + (trailingSpace ? " " : ""))
            } catch { NSSound.beep(); return false }
        }
        return false
    }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.command), !modifiers.contains(.control), !modifiers.contains(.option),
           let key = event.charactersIgnoringModifiers {
            let preferences = TerminalPreferences.shared
            switch key {
            case "+", "=": preferences.value.size = min(32, preferences.value.size + 1)
            case "-": preferences.value.size = max(9, preferences.value.size - 1)
            case "0": preferences.value.size = 13
            default: return super.performKeyEquivalent(with: event)
            }
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}
