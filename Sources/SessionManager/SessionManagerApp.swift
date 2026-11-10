import SwiftUI
import SessionCore

@main struct SessionManagerApp: App {
    @StateObject private var model = AppModel()
    @StateObject private var loginItem = LoginItem()
    var body: some Scene {
        WindowGroup("RunHuddle", id: "main") {
            ContentView().environmentObject(model)
                .frame(minWidth: 1000, minHeight: 640)
        }
        .defaultSize(width: 1320, height: 820)
        MenuBarExtra {
            MenuContent().environmentObject(model).environmentObject(loginItem)
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
        if model.connection.contains("unavailable") {
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
    private func bulk(_ operation: String) {
        let rows = model.sessions.filter { model.bulkSelection.contains($0.id) }
        Task { await model.prepareBulkCleanup(operation, rows: rows) }
    }
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 20) {
                Label { Text("RUNHUDDLE") } icon: { Image(nsImage: RunHuddleIcon.image()) }
                    .font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
                    .padding(.top, 12)
                VStack(spacing: 6) {
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
                Button("Connections…") { model.showSetup = true }
                if let notice = model.copilotConnectionNotice {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(notice).font(.caption)
                        Button("Got it") { model.dismissCopilotNotice() }.font(.caption)
                    }
                }
                if model.copilotConnectionError != nil {
                    Button("Copilot connection needs attention") { model.showSetup = true }.font(.caption)
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
                if !model.recentAlerts.isEmpty {
                    Text("RECENT ACTIVITY").font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(Array(model.recentAlerts.prefix(3))) { alert in
                        Button { model.showSession(alert.session.id) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(alert.title).font(.caption.bold())
                                Text(model.displayName(for: alert.session)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }.buttonStyle(.plain)
                    }
                }
                if let message = model.notificationMessage {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
                Button(model.notifications ? "Notification Settings…" : model.notificationBlocked ? "Open Notification Settings…" : "Enable desktop alerts") {
                    if model.notifications || model.notificationBlocked { model.openNotificationSettings() }
                    else { Task { await model.enableNotifications() } }
                }
                if model.notifications {
                    Button("Send test alert") { Task { await model.testNotification() } }
                    Text("Alerts: needs input + work finished").font(.caption2).foregroundStyle(.secondary)
                }
                Text("RunHuddle \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")")
                    .font(.caption2).foregroundStyle(.secondary)
                    .help(Bundle.main.bundlePath)
                Text("Local storage · 5-second refresh").font(.caption2).foregroundStyle(.secondary)
            }.padding(18)
            .navigationSplitViewColumnWidth(230)
        } detail: {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.filter).font(.largeTitle.bold())
                        Text("\(model.visible.count) sessions across \(model.projects) projects")
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.refreshing || model.cleaning { ProgressView().controlSize(.small) }
                    Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                        .help("Refresh live sessions")
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
                                Text("\(model.bulkSelection.count) selected").font(.caption)
                                Button("Select all results") { model.bulkSelection.formUnion(model.visible.filter { !$0.simulated }.map(\.id)) }
                                Button("Clear") { model.bulkSelection.removeAll() }
                                Menu("Actions") {
                                    Button("Archive…") { bulk("archive") }
                                    Button("Restore…") { bulk("restore") }
                                    Button("Remove archived histories…", role: .destructive) { bulk("delete") }
                                }.disabled(model.bulkSelection.isEmpty)
                            }
                            Spacer()
                        }.padding(12).disabled(model.cleaning)
                        List(selection: $model.selection) {
                            ForEach(model.visible) { row in
                                HStack {
                                    if model.bulkMode {
                                        Toggle("Select session", isOn: Binding(
                                            get: { model.bulkSelection.contains(row.id) },
                                            set: { if $0 { model.bulkSelection.insert(row.id) } else { model.bulkSelection.remove(row.id) } }
                                        )).labelsHidden().toggleStyle(.checkbox).disabled(row.simulated || model.cleaning)
                                    }
                                    SessionRow(row: row)
                                }.tag(row.id)
                                    .contextMenu {
                                        Button("Rename…") { model.beginRename(row) }
                                        if model.displayNames[row.id] != nil {
                                            Button("Reset to original name") { model.saveDisplayName("", for: row) }
                                        }
                                    }
                            }
                        }.listStyle(.inset)
                        .overlay {
                            if model.visible.isEmpty {
                                ContentUnavailableView("No sessions here", systemImage: "magnifyingglass", description: Text("Try another filter or check Connections."))
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
                    Circle().fill(!model.connection.contains("unavailable") ? .green : .orange).frame(width: 6, height: 6)
                    Text(model.connection).lineLimit(1).help(model.connection)
                    if let message = model.cleanupMessage { Text(message).lineLimit(1) }
                    Spacer()
                    if let date = model.lastRefresh { Text("Updated \(date, style: .time)") }
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
                Text("Find the existing terminal").font(.title2.bold())
                Text(model.displayName(for: row)).font(.headline)
                if model.navigatingTerminal {
                    HStack { ProgressView().controlSize(.small); Text(model.terminalProgress) }
                }
                Text(model.terminalMessage).font(.callout).foregroundStyle(.secondary)
                List(model.terminalTargets.sorted { $0.matches(row) && !$1.matches(row) }) { target in
                    Button { model.focusTerminal(target) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(target.app) · \(target.title.isEmpty ? "Untitled terminal" : target.title)")
                            Text("\(target.identity)\(target.matches(row) ? " · title matches this session" : "")").font(.caption).foregroundStyle(.secondary)
                        }.padding(4)
                    }.buttonStyle(.plain).disabled(model.navigatingTerminal)
                }.frame(height: 240)
                HStack {
                    Button("Refresh") { model.refreshTerminals() }
                    Spacer()
                    Button("Cancel") { model.terminalSession = nil }
                    Button("Open another Terminal window") { model.openAnotherTerminal(row) }
                }.disabled(model.navigatingTerminal)
            }.padding(24).frame(width: 640).interactiveDismissDisabled(model.navigatingTerminal)
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
                Text("\(model.sessions.filter { (!$0.simulated || model.showDemo) && ((title == "All sessions" && $0.state != .archived) || $0.state.title == title) }.count)")
                    .foregroundStyle(.secondary).monospacedDigit()
            }.padding(9).background(model.filter == title ? Color.accentColor.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8))
        }.buttonStyle(.plain)
    }
}

struct SessionRow: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(row.project).font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                Text(row.simulated ? "CLAUDE · DEMO" : row.provider.uppercased())
                    .font(.system(size: 9, weight: .bold)).foregroundStyle(row.simulated ? .purple : .secondary)
            }
            Text(model.displayName(for: row)).font(.system(size: 13, weight: .semibold)).lineLimit(2)
            if !model.purpose(for: row).isEmpty {
                Text(model.purpose(for: row).replacingOccurrences(of: "\n", with: " "))
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
            }.font(.caption)
        }.padding(.vertical, 9)
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
            Text(row.reason).font(.callout).foregroundStyle(.secondary)
            HStack {
                Button { model.resume(row) } label: {
                    HStack(spacing: 6) {
                        if model.navigatingTerminal { ProgressView().controlSize(.small) }
                        Text(model.navigatingTerminal ? model.terminalProgress : "Go to terminal")
                    }
                }
                    .buttonStyle(.borderedProminent)
                    .disabled(row.simulated || row.state == .archived || model.navigatingTerminal)
                Button { NSWorkspace.shared.open(URL(fileURLWithPath: row.cwd)) } label: { Image(systemName: "folder") }
                    .help("Open project folder").disabled(row.simulated || row.cwd.isEmpty)
                Button { model.copy(row.sessionID) } label: { Image(systemName: "doc.on.doc") }.help("Copy session ID")
            }
            if !row.simulated && row.provider == "Codex" {
                HStack {
                    if row.state == .archived {
                        Button("Restore…") { Task { await model.prepareCleanup("restore", row: row) } }
                        Button("Delete permanently…", role: .destructive) { Task { await model.prepareCleanup("delete", row: row) } }
                    } else {
                        Button("Archive…") { Task { await model.prepareCleanup("archive", row: row) } }
                            .disabled(row.state != .saved)
                        if row.state != .saved {
                            Text("Close the agent session before archiving.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }.disabled(model.cleaning)
            }
            if !row.simulated && row.provider != "Codex" {
                HStack {
                    if row.state == .archived {
                        Button("Restore…") { Task { await model.prepareBulkCleanup("restore", rows: [row]) } }
                        Button("Move history to Trash…", role: .destructive) { Task { await model.prepareBulkCleanup("delete", rows: [row]) } }
                    } else {
                        Button("Archive…") { Task { await model.prepareBulkCleanup("archive", rows: [row]) } }.disabled(row.state != .saved)
                        if row.state != .saved {
                            Text("Close the agent session before archiving.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }.disabled(model.cleaning)
            }
            Picker("Detail", selection: $tab) {
                Text("Overview").tag("Overview")
                Text("Handoff").tag("Handoff")
            }.pickerStyle(.segmented)
            if tab == "Overview" {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("What this session is for").font(.headline)
                        TextField("Add a short purpose for this session", text: Binding(
                            get: { model.briefs[row.id]?.purpose ?? "" },
                            set: { value in
                                var brief = model.briefs[row.id] ?? SessionBrief()
                                brief.purpose = value; model.setBrief(brief, for: row)
                            }), axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...4)
                        if model.briefs[row.id]?.purpose.isEmpty != false {
                            field("ORIGINAL REQUEST / PREVIEW", row.preview.isEmpty ? "No request recorded yet." : String(row.preview.prefix(1000)))
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
                            Text("Retrieved \(context.updated, style: .relative) ago · recorded messages, not an AI summary")
                                .font(.caption).foregroundStyle(.secondary)
                            if (context.sessionUpdated ?? 0) < row.updated {
                                Text("New session activity since this snapshot.").font(.caption).foregroundStyle(.secondary)
                            }
                            activityField("LATEST REQUEST", context.latestRequest ?? "No recent request available.")
                            activityField("AGENT'S LATEST RESPONSE", context.latestResponse ?? "No recent response available.")
                        }
                        Text("Next step / blocker").font(.headline)
                        TextField("Add where you want to pick up next", text: Binding(
                            get: { model.briefs[row.id]?.nextStep ?? "" },
                            set: { value in
                                var brief = model.briefs[row.id] ?? SessionBrief()
                                brief.nextStep = value; model.setBrief(brief, for: row)
                            }), axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(2...4)
                        Text("Your purpose and next-step notes save automatically and are never replaced by activity updates.")
                            .font(.caption).foregroundStyle(.secondary)
                        DisclosureGroup("Session info", isExpanded: $showSessionInfo) {
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
                        field("PROJECT", row.project)
                        field("WORKING DIRECTORY", row.cwd)
                        field("BRANCH", row.branch.isEmpty ? "Not recorded" : row.branch)
                        field("SESSION ID", row.sessionID)
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
    private func activityField(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
            Text(String(value.prefix(900)) + (value.count > 900 ? "…" : ""))
                .font(.callout).textSelection(.enabled).lineLimit(8)
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
