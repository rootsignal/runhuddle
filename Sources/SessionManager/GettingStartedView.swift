import SwiftUI

struct RunHuddleHelpCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    var body: some Commands {
        CommandGroup(replacing: .help) {
            Button("Getting started…") { openWindow(id: "getting-started") }
            Divider()
            Link("User guide", destination: URL(string: "https://github.com/rootsignal/runhuddle/blob/main/docs/USING_RUNHUDDLE.md")!)
            Link("Troubleshooting", destination: URL(string: "https://github.com/rootsignal/runhuddle/blob/main/docs/TROUBLESHOOTING.md")!)
            Link("Report an issue…", destination: URL(string: "https://github.com/rootsignal/runhuddle/issues")!)
        }
    }
}

struct GettingStartedView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    @Environment(\.openSettings) private var openSettings
    @AppStorage("showGettingStartedAtStartup") private var showAtStartup = true
    @ViewState private var showConnections = false
    @ViewState private var step = 0
    private let titles = ["Connect your agents", "Know when you’re needed", "Jump between sessions", "Keep useful work"]
    private let symbols = ["link", "bell.badge", "keyboard", "books.vertical"]
    private func settings(_ tab: String) { model.settingsTab = tab; openSettings() }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Image(nsImage: RunHuddleIcon.image(size: 36, appTile: true))
                VStack(alignment: .leading) {
                    Text("Getting started with RunHuddle").font(.title2.bold())
                    Text("Step \(step + 1) of 4").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Skip guide") { dismissWindow(id: "getting-started") }
            }
            HStack(spacing: 8) {
                ForEach(0..<4) { index in
                    Button { step = index } label: {
                        Image(systemName: symbols[index]).frame(maxWidth: .infinity).padding(10)
                            .background(step == index ? HuddleStyle.accent.opacity(0.2) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }.buttonStyle(.plain).help(titles[index]).accessibilityLabel(titles[index])
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(titles[step]).font(.title.bold())
                    switch step {
                    case 0:
                        Text("RunHuddle finds supported agents and local sessions automatically. Open Connections to see what’s detected and whether live tracking is ready.")
                        Text("Existing Claude or Copilot sessions may need to restart or resume after tracking hooks are installed. Saved history alone does not confirm a session is open.")
                            .foregroundStyle(.secondary)
                        Button("Check agent connections…") {
                            showConnections = true
                        }
                    case 1:
                        Label("Working — the agent reports work in progress.", systemImage: "bolt")
                        Label("Needs input — open the session to answer its request.", systemImage: "hand.raised")
                        Label("Idle — ready for your next prompt.", systemImage: "checkmark.circle")
                        Text("Notifications help you catch requests while RunHuddle is in the background. You can tune sounds, quiet hours, and reminders in Settings.").foregroundStyle(.secondary)
                        HStack {
                            Button(model.notifications ? "Notifications enabled" : "Enable notifications") { Task { await model.enableNotifications() } }
                                .disabled(model.notifications)
                            Button("Notification settings…") { settings("notifications") }
                        }
                        if model.notificationBlocked { Text("Notifications are blocked in macOS. Open notification settings to allow them.").font(.caption).foregroundStyle(.orange) }
                    case 2:
                        Text("Click the owl in your menu bar to see active sessions without opening the main window. Choose a session to bring its terminal forward.")
                        Text("Use ↑ and ↓ to choose, Return to switch, and Escape to dismiss. Configure a global shortcut in General settings to open the switcher from any app.").foregroundStyle(.secondary)
                        Button("Customize keyboard shortcut…") { settings("general") }
                        Text("Saved sessions reopen in your preferred terminal. Choose Terminal, iTerm2, or Ghostty and whether to open tabs or windows. Terminal tabs require Accessibility access; setup explains how to enable it.").font(.callout)
                        Button("Set up your terminal…") { settings("terminal") }
                        Text("If a running session cannot be matched confidently, RunHuddle asks you to locate its tab or pane.").font(.callout)
                    default:
                        Text("Archive a session to remove it from your active lists while keeping its history available.")
                        Text("Generate a handoff when you want to continue work in a new session. Review and edit it before using it.")
                        Text("Choose Save work summary… from a session’s actions, or Save to library from a handoff. Saved work is a separate, searchable library that survives deleting the original session.")
                        Text("AI generation is optional and uses your selected CLI account. You can write your own summary and export saved records as Markdown.").foregroundStyle(.secondary)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            Toggle("Show this guide at startup", isOn: $showAtStartup)
            Text("You can always reopen it from Help → Getting started or Settings → General.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Back") { step -= 1 }.disabled(step == 0)
                Spacer()
                Button(step == 3 ? "Get started" : "Next") {
                    if step == 3 { dismissWindow(id: "getting-started") } else { step += 1 }
                }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 570, height: 550).background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .sheet(isPresented: $showConnections) { AgentSetupView() }
            .task { await model.refreshNotificationStatus() }
    }
}
