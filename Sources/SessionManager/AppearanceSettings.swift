import SwiftUI

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

struct AppearancePicker: View {
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        Picker("Appearance", selection: $appearance) {
            ForEach(AppAppearance.allCases) { option in
                Text(option.title).tag(option.rawValue)
            }
        }
    }
}

struct AppearanceSettings: View {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("showGettingStartedAtStartup") private var showGuideAtStartup = true
    @EnvironmentObject var hotKey: SwitcherHotKey
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Appearance", systemImage: "circle.lefthalf.filled")
                .font(.title2.bold())
            AppearancePicker().pickerStyle(.segmented).labelsHidden()
            Text("System follows your Mac’s appearance. Light and Dark apply only to RunHuddle.")
                .font(.callout).foregroundStyle(.secondary)
            Divider()
            Text("Session switcher").font(.headline)
            Toggle("Enable global keyboard shortcut", isOn: Binding(get: { hotKey.enabled }, set: { hotKey.setEnabled($0) }))
            HStack {
                ShortcutRecorder(shortcut: hotKey.shortcut, commit: { hotKey.setShortcut($0) }).frame(width: 170, height: 28)
                Button("Reset") { hotKey.setShortcut(.standard) }
            }
            Text("Click the shortcut to record a new combination. Include Command, Control, or Option. Press Escape to cancel.")
                .font(.caption).foregroundStyle(.secondary)
            if let error = hotKey.error { Text(error).font(.caption).foregroundStyle(.orange) }
            Divider()
            Text("Help and guidance").font(.headline)
            Toggle("Show getting started guide at startup", isOn: $showGuideAtStartup)
            Button("Open getting started guide…") { openWindow(id: "getting-started") }
        }
        .padding(24)
        .frame(width: 380)
        .tint(HuddleStyle.accent)
    }
}
