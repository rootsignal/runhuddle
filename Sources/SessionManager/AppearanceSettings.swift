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

struct AppearanceSettings: View {
    @Environment(\.openWindow) private var openWindow
    @AppStorage("showGettingStartedAtStartup") private var showGuideAtStartup = true
    @EnvironmentObject var hotKey: SwitcherHotKey
    @EnvironmentObject var loginItem: LoginItem
    @EnvironmentObject var updater: AppUpdater
    var body: some View {
        ScrollView {
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
            Text("Startup").font(.headline)
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

struct TerminalSettings: View {
    @AppStorage("terminalLaunchStyle") private var terminalLaunchStyle = "tab"
    @AppStorage("preferredTerminal") private var preferredTerminal = PreferredTerminal.terminal.rawValue
    @ViewState private var accessibilityGranted = AXIsProcessTrusted()
    private var chosenTerminal: PreferredTerminal { .stored(preferredTerminal) }
    private func installed(_ terminal: PreferredTerminal) -> Bool {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: terminal.bundleID) != nil
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
            Label("Terminal setup", systemImage: "terminal").font(.title2.bold())
            Picker("Preferred terminal", selection: $preferredTerminal) {
                ForEach(PreferredTerminal.allCases) { terminal in
                    Text(terminal.title + (installed(terminal) ? "" : " (not installed)"))
                        .tag(terminal.rawValue).disabled(!installed(terminal))
                }
            }
            Picker("Open sessions in", selection: $terminalLaunchStyle) {
                Text("New tab").tag("tab")
                Text("New window").tag("window")
            }
            Text("Used for saved sessions, fresh handoffs, and saved work. Running sessions return to the terminal where they are already open. A new window opens if there is no existing window.")
                .font(.caption).foregroundStyle(.secondary)
            if !installed(chosenTerminal) {
                Label("This terminal is no longer installed. Choose another above.", systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(.orange)
            }
            if chosenTerminal == .terminal && terminalLaunchStyle == "tab" {
                VStack(alignment: .leading, spacing: 8) {
                    Label(accessibilityGranted ? "Terminal tabs are enabled" : "Allow access to open Terminal tabs",
                          systemImage: accessibilityGranted ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.headline).foregroundStyle(accessibilityGranted ? Color.green : Color.orange)
                    if !accessibilityGranted {
                        Text("macOS requires Accessibility access for RunHuddle to create a tab in Terminal. Until allowed, sessions open in a new window.")
                        Text("Open Accessibility settings, enable RunHuddle, then return here. If it is missing, use + to add RunHuddle from Applications.")
                        Button("Open macOS Accessibility settings…") {
                            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
                            _ = AXIsProcessTrustedWithOptions(options)
                            if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
                                NSWorkspace.shared.open(url)
                            }
                        }
                    }
                }.font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background((accessibilityGranted ? Color.green : Color.orange).opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            } else if chosenTerminal != .terminal {
                Text(chosenTerminal == .ghostty
                     ? "Requires Ghostty 1.3 or later with AppleScript enabled. macOS may ask to allow RunHuddle to control Ghostty."
                     : "macOS may ask to allow RunHuddle to control iTerm2. Its native tab support does not require Accessibility access.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            }.padding(24)
        }.frame(width: 520, height: 590)
            .onAppear { accessibilityGranted = AXIsProcessTrusted() }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                accessibilityGranted = AXIsProcessTrusted()
            }
            .tint(HuddleStyle.accent)
    }
}
