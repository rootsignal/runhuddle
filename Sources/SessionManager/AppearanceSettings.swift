import SwiftUI
import ApplicationServices
import SessionCore

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

struct GeneralSettings: View {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("showAgentChecklists") private var showAgentChecklists = true
    @AppStorage("reopenTerminalWorkspace") private var reopenTerminals = true
    @AppStorage("showGettingStartedAtStartup") private var showGuideAtStartup = true
    @EnvironmentObject var hotKey: SwitcherHotKey
    @EnvironmentObject var loginItem: LoginItem
    @EnvironmentObject var updater: AppUpdater
    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 16) {
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
            Toggle("Show agent checklists in Session info", isOn: $showAgentChecklists)
            Text("Appears only when the agent exposes a supported structured checklist.").font(.caption).foregroundStyle(.secondary)
            Divider()
            ProjectEditorSettings()
            Divider()
            Text("Startup").font(.headline)
            Toggle("Reopen terminal workspace on launch", isOn: $reopenTerminals)
            Text("Agents kept running reconnect with their existing terminal history. This does not survive a Mac restart.").font(.caption).foregroundStyle(.secondary)
            Toggle("Open RunHuddle at login", isOn: Binding(get: { loginItem.enabled }, set: { loginItem.setEnabled($0) }))
            if loginItem.needsApproval { Button("Open macOS Login Items settings…") { loginItem.openSettings() } }
            if let error = loginItem.error { Text(error).font(.caption).foregroundStyle(.orange) }
            Divider()
            Text("Help and guidance").font(.headline)
            Toggle("Show getting started guide at startup", isOn: $showGuideAtStartup)
            Button("Open getting started guide…") { openWindow(id: "getting-started") }
            Divider()
            Text("Updates").font(.headline)
            UpdateButton()
            Toggle("Check for updates automatically", isOn: Binding(get: { updater.checksAutomatically }, set: { updater.checksAutomatically = $0 }))
        }
        .padding(24)
        }
        .frame(width: 520, height: 590)
        .tint(HuddleStyle.accent)
        .onAppear { loginItem.refresh() }
    }
}

struct AppearanceSettings: View {
    @ObservedObject private var preferences = TerminalPreferences.shared
    @AppStorage("appAccentColor") private var appAccent = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label("App", systemImage: "macwindow").font(.title2.bold())
                AppearancePicker().pickerStyle(.segmented)
                    .disabled(preferences.value.coordinateApp && preferences.value.theme != "Follow app")
                ColorPicker("App accent", selection: Binding(get: { HuddleStyle.accent }, set: {
                    let hex = TerminalOptionsPreference.hex(NSColor($0))
                    if preferences.value.coordinateApp { preferences.value.customAccent = hex } else { appAccent = hex }
                }), supportsOpacity: false)
                Button("Use default app accent") {
                    if preferences.value.coordinateApp { preferences.value.customAccent = nil } else { appAccent = "" }
                }.disabled(preferences.value.coordinateApp ? preferences.value.customAccent == nil : appAccent.isEmpty)
                Toggle("Match app colors to terminal theme", isOn: $preferences.value.coordinateApp)
                Text(preferences.value.coordinateApp ? "App colors follow the terminal theme below. Turn matching off to style the app independently." : "Terminal themes affect only terminal content. App appearance and accent stay independent.")
                    .font(.caption).foregroundStyle(.secondary)
                Divider()
                EmbeddedTerminalSettings()
            }.padding(24)
        }.frame(width: 560, height: 650).tint(HuddleStyle.accent)
    }
}

struct TerminalSettings: View {
    @ObservedObject private var preferences = TerminalPreferences.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Terminal behavior", systemImage: "terminal").font(.title2.bold())
            Text("Themes, colors, fonts, and cursors are in Appearance.").font(.caption).foregroundStyle(.secondary)
            Picker("Scrollback", selection: $preferences.value.scrollback) {
                Text("1,000 lines").tag(1000)
                Text("10,000 lines").tag(10000)
                Text("50,000 lines").tag(50000)
            }
            Text("Limits this view’s local scrollback. Persistent terminals retain up to 50,000 lines for reconnection; saved conversations are unaffected.")
                .font(.caption).foregroundStyle(.secondary)
            Toggle("Use Option as Meta", isOn: $preferences.value.optionAsMeta)
            Text("Leave off to type accented characters with Option.").font(.caption).foregroundStyle(.secondary)
            Button("Restore terminal behavior defaults") {
                preferences.value.scrollback = 10000; preferences.value.optionAsMeta = false
            }
            Spacer()
        }.padding(24).frame(width: 560, height: 650).tint(HuddleStyle.accent)
    }
}
