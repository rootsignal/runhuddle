import SwiftUI
import SessionCore

@main struct SessionManagerApp: App {
    @StateObject private var model = AppModel()
    @StateObject private var loginItem = LoginItem()
    @StateObject private var updater = AppUpdater()
    var body: some Scene {
        Window("RunHuddle", id: "main") {
            ContentView().environmentObject(model).environmentObject(updater)
                .frame(minWidth: 1000, minHeight: 640)
        }
        .defaultSize(width: 1320, height: 820)
        .commands {
            CommandGroup(after: .appInfo) { UpdateButton().environmentObject(updater) }
        }
        MenuBarExtra {
            MenuContent().environmentObject(model).environmentObject(loginItem).environmentObject(updater)
        } label: {
            HStack(spacing: 4) {
                Image(nsImage: RunHuddleIcon.image())
                if model.navigatingTerminal { Text("…") }
                else if model.attentionCount > 0 { Text("\(model.attentionCount)") }
            }
            .accessibilityLabel(model.navigatingTerminal ? model.terminalProgress : "RunHuddle, \(model.attentionCount) sessions need input")
            .help(model.navigatingTerminal ? model.terminalProgress : "RunHuddle")
        }
    }
}

struct MenuContent: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) var openWindow
    @EnvironmentObject var loginItem: LoginItem
    private var menu: SessionMenu { SessionMenu(sessions: model.sessions, alerts: model.recentAlerts) }

    var body: some View {
        Text(menu.summary)
        if model.navigatingTerminal { Text(model.terminalProgress) }
        if model.connectionNeedsAttention {
            Text("Some agents are unavailable — showing last known sessions")
        }
        Divider()
        sessionGroup("Needs input", rows: menu.needsInput, limit: 5)
        sessionGroup("Working", rows: menu.working, limit: 5)
        sessionGroup("Recently finished", rows: menu.recentlyFinished, limit: 3)
        if menu.recentlyFinished.isEmpty {
            sessionGroup("Idle", rows: menu.idle, limit: 3)
        }
        if menu.needsInput.isEmpty && menu.working.isEmpty && menu.idle.isEmpty {
            Text("No active sessions")
            Divider()
        }
        Button("Open RunHuddle") { showWindow() }
        Button("Connections…") { model.showSetup = true; showWindow() }
        UpdateButton()
        Button(model.refreshing ? "Refreshing…" : "Refresh") { Task { await model.refresh() } }
            .disabled(model.refreshing || model.cleaning)
        Toggle("Open at Login", isOn: Binding(get: { loginItem.enabled }, set: { loginItem.setEnabled($0) }))
        if loginItem.needsApproval {
            Button("Allow in Login Items Settings…") { loginItem.openSettings() }
        }
        if let error = loginItem.error {
            Text(error)
            Button("Open Login Items Settings…") { loginItem.openSettings() }
        }
        Divider()
        Button("Quit RunHuddle") { NSApp.terminate(nil) }
            .onAppear { loginItem.refresh() }
    }

    @ViewBuilder private func sessionGroup(_ title: String, rows: [Session], limit: Int) -> some View {
        if !rows.isEmpty {
            Text(title)
            ForEach(Array(rows.prefix(limit))) { row in
                Button {
                    model.openMainWindow = { openWindow(id: "main") }
                    model.resume(row, fromMenu: true)
                } label: {
                    Label("\(short(row.project, 24)) · \(short(model.displayName(for: row), 46)) — \(row.state.title)", systemImage: row.state.symbol)
                }
                .help("\(row.provider) · \(row.cwd) · Go to terminal")
                .disabled(model.navigatingTerminal)
            }
            if rows.count > limit {
                Button("View all \(rows.count) \(title.lowercased()) sessions…") {
                    model.filter = rows[0].state.title
                    model.provider = "All tools"; model.query = ""
                    showWindow()
                }
            }
            Divider()
        }
    }
    private func showWindow() {
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }
    private func short(_ text: String, _ limit: Int) -> String {
        text.count > limit ? String(text.prefix(limit - 1)) + "…" : text
    }
}

extension SessionState {
    var color: Color {
        switch self {
        case .needsInput: .orange
        case .working: .blue
        case .idle: .green
        case .saved, .archived: .secondary
        case .disconnected: .red
        }
    }
    var symbol: String {
        switch self {
        case .needsInput: "hand.raised.fill"
        case .working: "bolt.fill"
        case .idle: "checkmark.circle"
        case .saved: "archivebox"
        case .disconnected: "wifi.slash"
        case .archived: "archivebox.fill"
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) var openWindow
    @ViewState private var confirmTerminalResume = false
    private func bulk(_ operation: String) {
        let rows = model.sessions.filter { model.bulkSelection.contains($0.id) }
        Task { await model.prepareBulkCleanup(operation, rows: rows) }
    }
    var body: some View {
        NavigationSplitView {
            ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Label { Text("RUNHUDDLE") } icon: { Image(nsImage: RunHuddleIcon.image()) }
                    .font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
                    .padding(.top, 12)
                VStack(spacing: 6) {
                    filterButton("Now", symbol: "sparkle", color: .accentColor)
                    filterButton("Pinned", symbol: "pin", color: .secondary)
                    filterButton("All sessions", symbol: "rectangle.stack", color: .primary)
                    ForEach(SessionState.allCases, id: \.self) { state in
                        filterButton(state.title, symbol: state.symbol, color: state.color)
                    }
                }
                Divider()
                Text("TOOLS").font(.caption.bold()).foregroundStyle(.secondary)
                Picker("Provider", selection: $model.provider) {
                    Text("All tools").tag("All tools")
                    Text("Codex").tag("Codex")
                    Text("Claude").tag("Claude")
                    Text("Copilot").tag("Copilot")
                }.labelsHidden()
                Text("PROJECT").font(.caption.bold()).foregroundStyle(.secondary)
                Picker("Project", selection: $model.projectFilter) {
                    Text("All projects").tag("All projects")
                    ForEach(model.projectPaths, id: \.self) { path in
                        Text(path.replacingOccurrences(of: NSHomeDirectory(), with: "~")).tag(path).help(path)
                    }
                }.labelsHidden().help(model.projectFilter)
                if model.claudeRepairNotice != nil || model.copilotConnectionNotice != nil {
                    Button { model.showSetup = true } label: {
                        Label("Tracking setup updated", systemImage: "info.circle")
                    }.font(.caption)
                }
                #if DEBUG
                DisclosureGroup("Demo sessions") {
                    Toggle("Show Claude demo", isOn: $model.showDemo)
                        .onChange(of: model.showDemo) { _, enabled in
                            if enabled { model.seedDemo() }
                            else if model.selected?.simulated == true { model.selection = nil }
                        }
                }.font(.caption)
                #endif
                Spacer()
            }.padding(18)
            }.scrollIndicators(.hidden)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 12) {
                Button { model.showSetup = true } label: {
                    Label(model.connectionSummary, systemImage: model.connectionNeedsAttention ? "exclamationmark.circle" : "circle.dotted.circle")
                        .font(.caption).foregroundStyle(model.connectionNeedsAttention ? Color.orange : .secondary)
                }.buttonStyle(.plain)
                Button(model.notifications ? "Notification settings…" : "Enable notifications") {
                    if model.notifications || model.notificationBlocked { model.openNotificationSettings() }
                    else { Task { await model.enableNotifications() } }
                }.font(.caption).buttonStyle(.plain)
                Text("RunHuddle \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")")
                    .font(.caption2).foregroundStyle(.secondary)
                    .help(Bundle.main.bundlePath)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(18).background(.bar)
            }
            .navigationSplitViewColumnWidth(230)
        } detail: {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.filter == "Now" && !model.query.isEmpty ? "Search results" : model.filter).font(.system(size: 28, weight: .bold))
                        Text(model.filter == "Now" && model.query.isEmpty ? "Your active work, with the next action in view." : "\(model.visible.count) sessions across \(model.projects) projects")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.cleaning { ProgressView().controlSize(.small); Text(model.cleanupProgress).font(.caption).foregroundStyle(.secondary) }
                    Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .help(model.refreshing ? "Checking activity…" : "Refresh live sessions").disabled(model.refreshing || model.cleaning)
                }.padding(24)
                HSplitView {
                    VStack(spacing: 0) {
                        TextField("Search sessions, projects, or conversation history", text: $model.query)
                            .textFieldStyle(.roundedBorder).padding(.horizontal, 16).padding(.bottom, 12)
                        if !model.query.isEmpty {
                            HStack(spacing: 6) {
                                if model.searchingHistory { ProgressView().controlSize(.small) }
                                Text(model.historySearchStatus).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }.padding(.horizontal, 16)
                        }
                        HStack {
                            Button(model.bulkMode ? "Done selecting" : "Select sessions") {
                                model.bulkMode.toggle()
                                if !model.bulkMode { model.bulkSelection.removeAll() }
                            }
                            if model.bulkMode {
                                Text("\(model.bulkSelection.count)").font(.caption).monospacedDigit().help("Selected sessions, including selections in other filters")
                                Menu("Selection") {
                                    Button("Select all results") { model.bulkSelection.formUnion(model.visible.filter { !$0.simulated }.map(\.id)) }
                                    Button("Clear selection") { model.bulkSelection.removeAll() }
                                }
                                Menu("Actions") {
                                    Button("Archive…") { bulk("archive") }
                                    Button("Restore…") { bulk("restore") }
                                    Button("Remove archived histories…", role: .destructive) { bulk("delete") }
                                }.disabled(model.bulkSelection.isEmpty)
                            }
                            Spacer()
                        }.padding(12).disabled(model.cleaning)
                        List(selection: $model.selection) {
                            if model.filter == "Now" && model.query.isEmpty {
                                ForEach(nowSections, id: \.title) { section in
                                    Section(section.title) { sessionCells(section.rows) }
                                }
                            } else {
                                sessionCells(model.visible)
                            }
                        }.listStyle(.inset)
                        .overlay {
                            if model.visible.isEmpty {
                                ContentUnavailableView {
                                    Label(model.filter == "Now" && model.query.isEmpty ? "Nothing needs your attention" : "No matching sessions", systemImage: model.filter == "Now" ? "checkmark.circle" : "magnifyingglass")
                                } description: {
                                    Text("Search your history, browse all sessions, or start work in your preferred agent.")
                                } actions: {
                                    Button("Browse all sessions") { model.filter = "All sessions" }
                                }
                            }
                        }
                    }.frame(minWidth: 320, idealWidth: 420)
                    Group {
                        if let row = model.selected { SessionDetail(row: row).id(row.id) }
                        else { ContentUnavailableView("Choose a session", systemImage: "rectangle.stack", description: Text("Review its status, resume work, or prepare a handoff.")) }
                    }.frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
                }
                Divider()
                HStack {
                    Button("Connections…") { model.showSetup = true }.buttonStyle(.plain)
                    if let message = model.cleanupMessage {
                        Text(message).lineLimit(2).help(message)
                        Button { model.cleanupMessage = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).help("Dismiss cleanup result")
                    }
                    Spacer()
                    if model.refreshing { Text("Checking activity…") }
                    else if let date = model.lastRefresh { Text("Updated \(date, style: .time)") }
                }.font(.caption).foregroundStyle(.secondary).padding(12)
            }
        }
        .alert("RunHuddle", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await model.refreshNotificationStatus() }
        }
        .onChange(of: model.query) { _, _ in model.scheduleHistorySearch() }
        .onAppear { model.openMainWindow = { openWindow(id: "main") } }
        .sheet(item: $model.bulkReview) { BulkCleanupView(review: $0) }
        .sheet(isPresented: $model.showSetup) { AgentSetupView() }
        .sheet(item: $model.renameSession) { row in
            VStack(alignment: .leading, spacing: 16) {
                Text("Rename session").font(.title2.bold())
                Text("This name is used in RunHuddle. The original agent title stays unchanged.")
                    .font(.callout).foregroundStyle(.secondary)
                TextField("Session name", text: $model.renameText).textFieldStyle(.roundedBorder)
                    .onSubmit { saveRename(row) }
                Text("Original: \(row.title)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                if let error = model.renameError { Text(error).font(.caption).foregroundStyle(.red) }
                HStack {
                    if model.displayNames[row.id] != nil {
                        Button("Reset to original") {
                            if model.saveDisplayName("", for: row) { model.renameSession = nil }
                        }
                    }
                    Spacer()
                    Button("Cancel") { model.renameSession = nil }.keyboardShortcut(.cancelAction)
                    Button("Save") { saveRename(row) }.keyboardShortcut(.defaultAction)
                        .disabled(model.renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }.padding(24).frame(width: 480)
        }
        .sheet(item: $model.cleanupPlan) { plan in
            VStack(alignment: .leading, spacing: 16) {
                Text("\(plan.title) \(plan.affected.count) session\(plan.affected.count == 1 ? "" : "s")?").font(.title2.bold())
                Text(plan.explanation).fixedSize(horizontal: false, vertical: true)
                List(plan.affected) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title)
                        Text(item.id).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                }.frame(height: 200)
                HStack {
                    Spacer()
                    Button("Cancel") { model.cleanupPlan = nil }.disabled(model.cleaning)
                    Button(plan.title, role: plan.action == "delete" ? .destructive : nil) {
                        Task { await model.applyCleanup(plan) }
                    }.disabled(model.cleaning)
                }
            }.padding(24).frame(width: 620).interactiveDismissDisabled(model.cleaning)
        }
        .sheet(item: $model.terminalSession) { row in
            VStack(alignment: .leading, spacing: 16) {
                Text(row.state == .saved ? "Resume session" : "Locate terminal").font(.title2.bold())
                Text(model.displayName(for: row)).font(.headline)
                if model.navigatingTerminal {
                    HStack { ProgressView().controlSize(.small); Text(model.terminalProgress) }
                }
                Text(model.terminalMessage).font(.callout).foregroundStyle(.secondary)
                if model.terminalTargets.isEmpty && !model.navigatingTerminal {
                    Text("No accessible terminal tabs were found. You can resume in a new Terminal window below.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                if !model.terminalTargets.isEmpty {
                List(TerminalTarget.ordered(model.terminalTargets, for: row)) { target in
                    Button { model.focusTerminal(target) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(target.app) · \(target.title.isEmpty ? "Untitled terminal" : target.title)")
                            Text(target.matchLabel(for: row)).font(.caption).foregroundStyle(.secondary)
                            Text(target.identity).font(.caption2).foregroundStyle(.secondary)
                        }.padding(4)
                    }.buttonStyle(.plain).disabled(model.navigatingTerminal)
                }.frame(height: 240)
                }
                if model.terminalMessage.contains("Automation settings") {
                    Button("Open Automation settings…") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation") { NSWorkspace.shared.open(url) }
                    }
                }
                HStack {
                    Button("Refresh") { model.refreshTerminals() }
                    Spacer()
                    Button("Cancel") { model.terminalSession = nil }
                    Button(row.state == .saved ? "Resume in Terminal" : "Open another Terminal window…") {
                        if row.state == .saved { model.openAnotherTerminal(row) }
                        else { confirmTerminalResume = true }
                    }
                }.disabled(model.navigatingTerminal)
            }.padding(24).frame(width: 640).interactiveDismissDisabled(model.navigatingTerminal)
            .confirmationDialog("Resume in another terminal?", isPresented: $confirmTerminalResume) {
                Button("Resume in another Terminal window") { model.openAnotherTerminal(row) }
            } message: {
                Text("This session may still have a running process. Resuming opens another terminal; it does not stop the existing process.")
            }
        }
    }
    private var nowSections: [(title: String, rows: [Session])] {
        let finished = Set(model.recentAlerts.filter { $0.kind == .finished }.map { $0.session.id })
        return [
            ("Needs input", model.visible.filter { $0.state == .needsInput }),
            ("Working", model.visible.filter { $0.state == .working }),
            ("Recently finished", model.visible.filter { $0.state == .idle && finished.contains($0.id) }),
            ("Idle", model.visible.filter { $0.state == .idle && !finished.contains($0.id) })
        ].filter { !$0.1.isEmpty }
    }
    @ViewBuilder private func sessionCells(_ rows: [Session]) -> some View {
        ForEach(rows) { row in
            HStack {
                if model.bulkMode {
                    Toggle("Select session", isOn: Binding(
                        get: { model.bulkSelection.contains(row.id) },
                        set: { if $0 { model.bulkSelection.insert(row.id) } else { model.bulkSelection.remove(row.id) } }
                    )).labelsHidden().toggleStyle(.checkbox).disabled(row.simulated || model.cleaning)
                }
                SessionRow(row: row)
            }.tag(row.id).contextMenu {
                Button(model.pinned.contains(row.id) ? "Unpin session" : "Pin session") { model.togglePin(row) }
                Button("Rename…") { model.beginRename(row) }
                if model.displayNames[row.id] != nil {
                    Button("Reset to original name") { model.saveDisplayName("", for: row) }
                }
            }
        }
    }
    private func saveRename(_ row: Session) {
        guard !model.renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if model.saveDisplayName(model.renameText, for: row) { model.renameSession = nil }
    }
    private func filterButton(_ title: String, symbol: String, color: Color) -> some View {
        Button { model.filter = title } label: {
            HStack {
                Image(systemName: symbol).foregroundStyle(color).frame(width: 18)
                Text(title)
                Spacer()
                Text("\(model.count(for: title))")
                    .foregroundStyle(.secondary).monospacedDigit()
            }.frame(maxWidth: .infinity, alignment: .leading)
                .padding(9)
                .contentShape(Rectangle())
                .background(model.filter == title ? Color.accentColor.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8))
        }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue("\(model.count(for: title)) sessions")
    }
}

struct SessionRow: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                if model.pinned.contains(row.id) { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary) }
                Text(row.project).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(row.simulated ? "CLAUDE · DEMO" : row.provider.uppercased())
                    .font(.system(size: 9, weight: .medium)).foregroundStyle(row.simulated ? .purple : .secondary)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(.quaternary.opacity(0.3), in: Capsule())
            }
            Text(model.displayName(for: row)).font(.system(size: 13, weight: .semibold)).lineLimit(2)
            if !model.activitySummary(for: row).isEmpty {
                Text(model.activitySummary(for: row))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            if model.historySearchQuery == model.query, let match = model.historyMatches[row.id] {
                Text("\(match.role.capitalized): \(match.excerpt)")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(3)
            }
            HStack {
                Label(row.state.title, systemImage: row.state.symbol).foregroundStyle(row.state.color)
                if let usage = row.contextUsage, let fraction = usage.fraction {
                    Text("Context \(Int((fraction * 100).rounded()))%")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(Date(timeIntervalSince1970: row.updated), style: .relative).foregroundStyle(.secondary)
                    .help("Time since recorded activity or a status change. This is not the last connection check.")
            }.font(.caption)
        }.padding(.vertical, 9).accessibilityElement(children: .combine)
    }
}

struct SessionDetail: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    @ViewState private var tab = "Overview"
    @ViewState private var confirmFresh = false
    @ViewState private var showSessionInfo = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(row.state.title, systemImage: row.state.symbol).foregroundStyle(row.state.color)
                Spacer()
                if row.simulated { Text("SIMULATED SESSION").font(.caption.bold()).foregroundStyle(.purple) }
            }.font(.subheadline.bold())
            HStack(alignment: .top) {
                Text(model.displayName(for: row)).font(.title2.bold()).textSelection(.enabled)
                Spacer()
                Button { model.beginRename(row) } label: { Image(systemName: "pencil") }
                    .help("Rename session").accessibilityLabel("Rename session")
            }
            Text("\(row.project) · \(SessionPresentation.statusSummary(row))").font(.callout).foregroundStyle(.secondary)
            if row.state == .disconnected {
                Text("Check the agent or locate its terminal before resuming. Recorded history is still available below.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button { model.resume(row) } label: {
                    HStack(spacing: 6) {
                        if model.navigatingTerminal { ProgressView().controlSize(.small) }
                        Text(model.navigatingTerminal ? model.terminalProgress : model.terminalActionTitle(for: row))
                    }
                }
                    .buttonStyle(.borderedProminent)
                    .disabled(row.simulated || row.state == .archived || model.navigatingTerminal)
                Button { NSWorkspace.shared.open(URL(fileURLWithPath: row.cwd)) } label: { Image(systemName: "folder") }
                    .help("Open project folder").disabled(row.simulated || row.cwd.isEmpty)
                Button { model.togglePin(row) } label: { Image(systemName: model.pinned.contains(row.id) ? "pin.fill" : "pin") }
                    .help(model.pinned.contains(row.id) ? "Unpin session" : "Pin session")
                cleanupMenu
            }
            Picker("Detail", selection: $tab) {
                Text("Overview").tag("Overview")
                Text("Handoff").tag("Handoff")
            }.pickerStyle(.segmented)
            if tab == "Overview" {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if !model.activitySummary(for: row).isEmpty {
                            Text(model.activitySummary(for: row)).font(.body).textSelection(.enabled)
                        }
                        HStack {
                            Text("Latest recorded activity").font(.headline)
                            Spacer()
                            Button { Task { await model.appendHistory(row) } } label: { Image(systemName: "arrow.clockwise") }
                                .disabled(row.simulated || model.historyLoading.contains(row.id)).help("Refresh recorded activity")
                        }
                        if model.historyLoading.contains(row.id) { ProgressView("Loading recorded activity…").controlSize(.small) }
                        if let failure = model.historyErrors[row.id] {
                            Text("Could not refresh activity. \(failure)").font(.caption).foregroundStyle(.orange)
                        }
                        if let context = model.contexts[row.id] {
                            Text("Recorded activity · updated \(context.updated, style: .relative) ago")
                                .font(.caption).foregroundStyle(.secondary)
                            if (context.sessionUpdated ?? 0) < row.updated {
                                Text("New session activity since this snapshot.").font(.caption).foregroundStyle(.secondary)
                            }
                            activityField("LATEST REQUEST", context.latestRequest ?? "No recent request available.")
                            activityField("AGENT'S LATEST RESPONSE", context.latestResponse ?? "No recent response available.")
                        }
                        DisclosureGroup("Your notes") {
                            VStack(alignment: .leading, spacing: 12) {
                                TextField("What is this session for?", text: Binding(
                                    get: { model.briefs[row.id]?.purpose ?? "" },
                                    set: { value in
                                        var brief = model.briefs[row.id] ?? SessionBrief()
                                        brief.purpose = value; model.setBrief(brief, for: row)
                                    }), axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...4)
                                TextField("Next step or blocker", text: Binding(
                                    get: { model.briefs[row.id]?.nextStep ?? "" },
                                    set: { value in
                                        var brief = model.briefs[row.id] ?? SessionBrief()
                                        brief.nextStep = value; model.setBrief(brief, for: row)
                                    }), axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...4)
                                Text("Saved automatically. Activity updates never replace your notes.").font(.caption).foregroundStyle(.secondary)
                            }.padding(.top, 8)
                        }
                        DisclosureGroup("Session details", isExpanded: $showSessionInfo) {
                            VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Context").font(.subheadline.bold())
                    Spacer()
                    Button("Prepare handoff") { tab = "Handoff" }
                }
                if let usage = row.contextUsage, let fraction = usage.fraction {
                    HStack {
                        Text("\(Int((fraction * 100).rounded()))% · \(usage.used.formatted()) / \(usage.limit.formatted()) tokens")
                        Spacer()
                    }.font(.caption)
                    ProgressView(value: min(fraction, 1))
                        .tint(.blue)
                    Text("Last reported estimate · \(contextTimestamp(usage.reportedAt))")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text("Context usage can decrease when older history is compacted.")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("Unavailable — no verified context usage for this session.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
                        if model.displayNames[row.id] != nil {
                            field("ORIGINAL TITLE", row.title)
                            Button("Reset to original name") { model.saveDisplayName("", for: row) }
                        }
                        field("STATUS SOURCE", row.reason)
                        field("PROJECT", row.project)
                        field("WORKING DIRECTORY", row.cwd)
                        field("BRANCH", row.branch.isEmpty ? "Not recorded" : row.branch)
                        field("SESSION ID", row.sessionID)
                        Button("Copy session ID") { model.copy(row.sessionID) }
                        field("RECORDED PREVIEW", row.preview.isEmpty ? "No preview recorded" : row.preview)
                            }.padding(.top, 10)
                        }
                        if row.simulated {
                            Divider()
                            Text("Simulate a Claude event").font(.headline)
                            Text("These events change only this demo. No Claude calls or charges.").font(.caption).foregroundStyle(.secondary)
                            ForEach(ClaudeEvent.allCases, id: \.rawValue) { event in
                                Button(event.rawValue) { model.simulate(event, row: row) }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Text("Your notes · saved automatically. Recorded context updates separately below.")
                    .font(.caption).foregroundStyle(.secondary)
                TextEditor(text: Binding(get: { model.draft(for: row) }, set: { model.setDraft($0, for: row.id) }))
                    .font(.system(size: 12, design: .monospaced)).border(.quaternary)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Recorded context").font(.headline)
                    if let failure = model.historyErrors[row.id] {
                        Text((model.contexts[row.id] == nil ? "Context unavailable. " : "Using cached context. ") + failure)
                            .font(.caption).foregroundStyle(.orange).lineLimit(3)
                    }
                    if let context = model.contexts[row.id] {
                        Text("Updated \(context.updated, style: .relative) ago").font(.caption).foregroundStyle(.secondary)
                        ScrollView { Text(context.text).font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                            .frame(maxHeight: 160)
                    } else {
                        Text(row.simulated ? "Simulated session; no recorded context." : "Recorded context has not been loaded.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                HStack {
                    Button(model.historyLoading.contains(row.id) ? "Loading…" : "Refresh recorded context") { Task { await model.appendHistory(row) } }
                        .disabled(row.simulated || model.historyLoading.contains(row.id))
                    Button("Copy") { Task { await model.copyHandoff(row) } }
                    Button("Export…") { Task { await model.export(row) } }
                }
                Button("Start fresh with this handoff…") { confirmFresh = true }
                    .disabled(row.simulated).buttonStyle(.borderedProminent)
            }
            Spacer(minLength: 0)
        }.padding(24)
        .task(id: row.id + ":" + tab) {
            await model.appendHistory(row)
        }
        .confirmationDialog("Start a new \(row.provider) session with this handoff?", isPresented: $confirmFresh) {
            Button("Start fresh in Terminal") { Task { await model.fresh(row) } }
        } message: { Text("The edited handoff will be sent as the first prompt. Your original session stays available.") }
    }
    private var cleanupMenu: some View {
        Menu {
            Button("Rename…") { model.beginRename(row) }
            Divider()
            if row.state == .archived {
                Button("Restore…") { cleanup("restore") }
                Button(row.provider == "Codex" ? "Delete permanently…" : "Move history to Trash…", role: .destructive) { cleanup("delete") }
            } else {
                Button("Archive…") { cleanup("archive") }.disabled(row.state != .saved)
                if row.state != .saved { Text("Close the session before archiving") }
            }
        } label: { Image(systemName: "ellipsis") }
            .disabled(row.simulated || model.cleaning).help("Session actions")
    }
    private func cleanup(_ operation: String) {
        Task { await model.prepareBulkCleanup(operation, rows: [row]) }
    }
    private func activityField(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
            Text(SessionPresentation.excerpt(value, limit: 240))
                .font(.callout).textSelection(.enabled).lineLimit(3)
            DisclosureGroup("Read recorded message") {
                Text(value).font(.callout).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }.font(.caption)
        }
    }
    private func contextTimestamp(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        return date?.formatted(date: .abbreviated, time: .shortened) ?? "time unavailable"
    }
    private func field(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
            Text(value).font(.callout).textSelection(.enabled)
        }
    }
}
