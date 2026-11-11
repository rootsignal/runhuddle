import SwiftUI
import SessionCore

@main struct SessionManagerApp: App {
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    @StateObject private var model = AppModel()
    @StateObject private var loginItem = LoginItem()
    @StateObject private var updater = AppUpdater()
    @StateObject private var switcher = SessionSwitcherController()
    var body: some Scene {
        Window("RunHuddle", id: "main") {
            ContentView().environmentObject(model).environmentObject(updater)
                .onAppear {
                    switcher.start(model: model, loginItem: loginItem, updater: updater)
                    model.onTerminalOpened = { [weak switcher] in switcher?.terminalDidOpen() }
                }
                .frame(minWidth: 760, minHeight: 640)
                .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        HStack(spacing: 8) {
                            Image(nsImage: RunHuddleIcon.image(size: 24, appTile: true))
                                .accessibilityHidden(true)
                            Text("RunHuddle").font(.headline)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1320, height: 820)
        .commands {
            CommandGroup(after: .appInfo) { UpdateButton().environmentObject(updater) }
            SearchSessionCommands()
        }
        Settings {
            TabView(selection: $model.settingsTab) {
                AppearanceSettings().environmentObject(switcher.hotKey).tabItem { Label("General", systemImage: "gearshape") }.tag("general")
                NotificationSettingsView().environmentObject(model).tabItem { Label("Notifications", systemImage: "bell") }.tag("notifications")
            }
                .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
        }
    }
}


struct ContentView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) var openWindow
    @Environment(\.openSettings) private var openSettings
    @ViewState private var showDetails = false
    @ViewState private var sidebarVisible = true
    @ViewState private var showHistoryFilters = false
    private var isNow: Bool { model.filter == "Now" && model.query.isEmpty }
    @ViewState private var confirmTerminalResume = false
    @FocusState private var searchFocused: Bool
    @FocusState private var listFocused: Bool
    private func bulk(_ operation: String) {
        let rows = model.sessions.filter { model.bulkSelection.contains($0.id) }
        Task { await model.prepareBulkCleanup(operation, rows: rows) }
    }
    var body: some View {
        WorkspaceLayout(sidebarVisible: sidebarVisible) {
            // Keep the header outside the scroll view: sidebar scroll content can
            // extend beneath the unified title bar and its window controls.
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image(nsImage: RunHuddleIcon.image(size: 22, appTile: true))
                    Text("WORKSPACE")
                        .font(.system(size: 10, weight: .semibold)).tracking(1)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)
                ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(spacing: 2) {
                    filterButton("Now", symbol: "sparkle", color: .accentColor)
                    filterButton("Pinned", symbol: "pin", color: .secondary)
                    filterButton("All sessions", symbol: "rectangle.stack", color: .primary)
                    Divider().padding(.vertical, 8)
                    ForEach([SessionState.needsInput, .working, .idle, .disconnected], id: \.self) { state in
                        filterButton(state.title, symbol: state.symbol, color: state.color)
                    }
                    DisclosureGroup("History", isExpanded: $showHistoryFilters) {
                        ForEach([SessionState.saved, .archived], id: \.self) { state in
                            filterButton(state.title, symbol: state.symbol, color: state.color)
                        }
                    }.font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                        .padding(.horizontal, 9).padding(.top, 8)
                }
                Divider()
                Text("TOOLS").font(.system(size: 10, weight: .semibold)).tracking(1).foregroundStyle(.secondary)
                Picker("Provider", selection: $model.provider) {
                    Text("All tools").tag("All tools")
                    Text("Codex").tag("Codex")
                    Text("Claude").tag("Claude")
                    Text("Copilot").tag("Copilot")
                }.labelsHidden()
                Text("PROJECT").font(.system(size: 10, weight: .semibold)).tracking(1).foregroundStyle(.secondary)
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
            }
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 12) {
                Button { model.showSetup = true } label: {
                    Label(model.connectionSummary, systemImage: model.connectionNeedsAttention ? "exclamationmark.circle" : "circle.dotted.circle")
                        .font(.caption).foregroundStyle(model.connectionNeedsAttention ? Color.orange : .secondary)
                }.buttonStyle(.plain)
                Button(model.notifications ? "Notification settings…" : "Enable notifications") {
                    if model.notifications || model.notificationBlocked { model.settingsTab = "notifications"; openSettings() }
                    else { Task { await model.enableNotifications() } }
                }.font(.caption).buttonStyle(.plain)
                Text("RunHuddle \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")")
                    .font(.caption2).foregroundStyle(.secondary)
                    .help(Bundle.main.bundlePath)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(18).background(.bar)
            }

        } detail: {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(model.isSearching ? "Search results" : model.filter).font(.system(size: 22, weight: .semibold, design: .rounded))
                        Text(model.filter == "Now" && model.query.isEmpty ? "Your active work, with the next action in view." : "\(model.visible.count) \(model.visible.count == 1 ? "session" : "sessions") across \(model.projects) \(model.projects == 1 ? "project" : "projects")")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    if model.selected != nil {
                        Button { showDetails.toggle() } label: {
                            Image(systemName: "sidebar.right")
                        }.help(showDetails ? "Hide session details" : "Show session details")
                            .accessibilityLabel(showDetails ? "Hide session details" : "Show session details")
                    }
                    if model.cleaning { ProgressView().controlSize(.small); Text(model.cleanupProgress).font(.caption).foregroundStyle(.secondary) }
                    Button { Task { await model.refresh(userInitiated: true) } } label: {
                        if model.manualRefreshing { ProgressView().controlSize(.small) }
                        else { Image(systemName: "arrow.clockwise") }
                    }
                        .help("Refresh live sessions").disabled(model.manualRefreshing || model.cleaning)
                }.padding(.horizontal, 20).padding(.vertical, 12)
                if isNow && model.visible.contains(where: { $0.state == .needsInput }) {
                    NowAttentionPanel(
                        sessions: model.visible,
                        title: { model.displayName(for: $0) },
                        navigating: model.navigatingTerminal,
                        inspect: { row in model.selection = row.id; showDetails = true },
                        resume: { row in model.resume(row) },
                        showAll: { model.filter = "Needs input" }
                    ).padding(.horizontal, 24).padding(.bottom, 10)
                }
                SessionColumns(showDetails: showDetails) {
                    VStack(spacing: 0) {
                        if !model.query.isEmpty {
                            HStack(spacing: 8) {
                                Button("Done") { model.query = ""; searchFocused = false }
                                Picker("Search scope", selection: $model.searchScope) {
                                    ForEach(SessionSearchScope.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                                }.labelsHidden().fixedSize().help("Everywhere includes archived sessions and ignores agent, project, and view filters")
                                if model.searchingHistory { ProgressView().controlSize(.small) }
                                Text(model.historySearchStatus).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                Spacer(minLength: 0)
                            }.padding(.horizontal, 16).padding(.top, 8)
                            Text(model.searchScope == .everywhere ? "All agents and projects · includes archived sessions" : "\(model.filter) · \(model.provider) · \(model.projectFilter == "All projects" ? "All projects" : URL(fileURLWithPath: model.projectFilter).lastPathComponent)")
                                .font(.caption2).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.bottom, 8)
                        }
                        if model.bulkMode {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Button("Done") { model.bulkMode = false; model.bulkSelection.removeAll() }
                                    Text("\(model.bulkSelection.count) selected").font(.caption).monospacedDigit()
                                    Spacer()
                                    Menu("Selection") {
                                        Button("Select all results") { model.bulkSelection.formUnion(model.visible.filter { !$0.simulated }.map(\.id)) }
                                        Button("Clear selection") { model.bulkSelection.removeAll() }
                                    }
                                }
                                HStack {
                                    Button("Archive…") { bulk("archive") }
                                    Button("Restore…") { bulk("restore") }
                                    Button("Delete archived…", role: .destructive) { bulk("delete") }
                                        .help("Review removal of archived histories. Active sessions are skipped.")
                                }.disabled(model.bulkSelection.isEmpty)
                            }.padding(12).disabled(model.cleaning)
                        } else {
                            HStack {
                                Spacer()
                                Button { model.bulkMode = true } label: {
                                    Label("Bulk actions", systemImage: "checklist")
                                        .font(.caption).foregroundStyle(.secondary)
                                }.buttonStyle(.plain).disabled(model.cleaning)
                                    .help("Select sessions to archive, restore, or delete")
                            }.padding(.horizontal, 16).frame(height: 28)
                        }
                        ScrollViewReader { proxy in
                        List {
                            if model.filter == "Now" && model.query.isEmpty {
                                ForEach(nowSections, id: \.title) { section in
                                    Section { sessionCells(section.rows) } header: {
                                        HStack {
                                            Text(section.title).font(.system(size: 11, weight: .semibold))
                                            Text("\(section.rows.count)").font(.system(size: 10)).foregroundStyle(.secondary)
                                            Spacer()
                                        }.foregroundStyle(.secondary).padding(.top, 6).padding(.bottom, 2)
                                    }
                                }
                            } else {
                                sessionCells(model.visible)
                            }
                        }.listStyle(.plain).scrollContentBackground(.hidden)
                        .focusable().focused($listFocused).focusEffectDisabled()
                        .onMoveCommand { direction in
                            guard !searchFocused, direction == .up || direction == .down else { return }
                            let rows = model.filter == "Now" && model.query.isEmpty ? nowSections.flatMap(\.rows) : model.visible
                            guard !rows.isEmpty else { return }
                            let index = rows.firstIndex { $0.id == model.selection } ?? (direction == .down ? -1 : rows.count)
                            let next = min(max(index + (direction == .down ? 1 : -1), 0), rows.count - 1)
                            model.selection = rows[next].id
                            showDetails = true
                            proxy.scrollTo(rows[next].id)
                        }
                        .overlay {
                            if model.visible.isEmpty {
                                ContentUnavailableView {
                                    Label(model.filter == "Now" && model.query.isEmpty ? "Nothing needs your attention" : "No matching sessions", systemImage: model.filter == "Now" ? "checkmark.circle" : "magnifyingglass")
                                } description: {
                                    Text("Search your history, browse all sessions, or start work in your preferred agent.")
                                } actions: {
                                    Button("Browse all sessions") { model.query = ""; model.filter = "All sessions" }
                                }
                            }
                        }
                        }
                    }.background(HuddleStyle.canvas)
                } detail: {
                        VStack(spacing: 0) {
                            HStack {
                                    Text("SESSION DETAILS").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                                    Spacer()
                                    Button { showDetails = false } label: { Image(systemName: "xmark") }
                                        .buttonStyle(.plain).help("Close session details").accessibilityLabel("Close session details")
                            }.padding(.horizontal, 24).padding(.top, 12)
                            if let row = model.selected { SessionDetail(row: row).id(row.id) }
                            else { ContentUnavailableView("Choose a session", systemImage: "rectangle.stack", description: Text("Review its status, resume work, or prepare a handoff.")) }
                        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(HuddleStyle.panel)
                }
                Divider()
                HStack {
                    Button("Connections…") { model.showSetup = true }.buttonStyle(.plain)
                    if let message = model.cleanupMessage {
                        Text(message).lineLimit(2).help(message)
                        Button { model.cleanupMessage = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).help("Dismiss cleanup result")
                    }
                    Spacer()
                    if model.manualRefreshing { Text("Checking activity…") }
                    else {
                        Text("Activity updates automatically")
                            .help(model.lastRefresh.map { "Last checked: " + $0.formatted(date: .omitted, time: .standard) } ?? "Waiting for the first activity check")
                    }
                }.font(.caption).foregroundStyle(.secondary).padding(12)
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { sidebarVisible.toggle() } label: { Image(systemName: "sidebar.left") }
                    .help(sidebarVisible ? "Hide sidebar" : "Show sidebar")
                    .accessibilityLabel(sidebarVisible ? "Hide sidebar" : "Show sidebar")
            }
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search sessions", text: $model.query)
                        .textFieldStyle(.plain).focused($searchFocused)
                        .onExitCommand { model.query = ""; searchFocused = false }
                        .accessibilityLabel("Search sessions, projects, and messages")
                    if !model.query.isEmpty {
                        Button { model.query = ""; searchFocused = true } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                            .help("Clear search (Escape)").accessibilityLabel("Clear search")
                    }
                }.padding(.horizontal, 8).frame(width: 210, height: 28)
                    .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(searchFocused ? HuddleStyle.accent : .clear))
                    .help("Search sessions (⌘F)")
            }

        }
        .focusedSceneValue(\.searchSessions, { searchFocused = true })
        .tint(HuddleStyle.accent)
        .background(HuddleStyle.canvas)
        .alert("RunHuddle", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await model.refreshNotificationStatus() }
        }
        .onChange(of: model.query) { _, _ in model.scheduleHistorySearch() }
        .onAppear {
            model.openMainWindow = { openWindow(id: "main") }
            model.openSettingsWindow = { openSettings() }
        }
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
                            Text("\(target.app) · \(target.displayTitle.isEmpty ? "Untitled terminal" : target.displayTitle)")
                            Text(target.matchLabel(for: row)).font(.caption).foregroundStyle(.secondary)
                            Text(target.sessionTTY.isEmpty ? target.identity : target.sessionTTY).font(.caption2).foregroundStyle(.secondary)
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
                Button { model.selection = row.id; showDetails = true; searchFocused = false; listFocused = true } label: {
                    SessionRow(row: row).contentShape(Rectangle())
                }.buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(model.selection == row.id ? .isSelected : [])
                if !model.bulkMode && !row.simulated && row.state != .archived {
                    SessionTerminalButton(row: row)
                }
            }.modifier(SessionCardSurface(selected: model.selection == row.id))
                .background {
                    // Make row padding selectable without a parent gesture that
                    // also fires when the separate terminal shortcut is pressed.
                    Color.clear.contentShape(Rectangle()).onTapGesture {
                        model.selection = row.id; showDetails = true; searchFocused = false; listFocused = true
                    }
                }
                .listRowSeparator(.hidden).listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 2, leading: 14, bottom: 2, trailing: 14))
                .id(row.id).contextMenu {
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
        Button { model.query = ""; model.filter = title; showDetails = false; searchFocused = false; listFocused = true } label: {
            HStack {
                Image(systemName: symbol).foregroundStyle(color).frame(width: 18)
                Text(title).font(.system(size: 13, weight: model.filter == title ? .semibold : .medium))
                Spacer()
                Text("\(model.count(for: title))")
                    .font(.system(size: 11)).foregroundStyle(.secondary).monospacedDigit()
                    .padding(.horizontal, 6).padding(.vertical, 2)

            }.frame(maxWidth: .infinity, alignment: .leading)
                .padding(9)
                .contentShape(Rectangle())
                .background(model.filter == title ? HuddleStyle.accent.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 8))
        }.buttonStyle(.plain).accessibilityLabel(title).accessibilityValue("\(model.count(for: title)) sessions")
    }
}

struct SessionTerminalButton: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    private var busy: Bool { model.navigatingTerminal && model.terminalNavigationSessionID == row.id }
    var body: some View {
        Button { model.resume(row) } label: {
            Group {
                if busy { ProgressView().controlSize(.small) }
                else { Image(systemName: row.state == .saved ? "play.rectangle" : "terminal") }
            }.frame(width: 28, height: 28)
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain).foregroundStyle(HuddleStyle.accent)
        .background(HuddleStyle.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 6))
        .disabled(model.navigatingTerminal || model.cleaning)
        .help(busy ? model.terminalProgress : model.terminalActionTitle(for: row))
        .accessibilityLabel(model.terminalActionTitle(for: row) + ": " + model.displayName(for: row))
        .accessibilityValue(busy ? model.terminalProgress : "")
    }
}

struct SessionRow: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    var body: some View {
        SessionCardContent(row: row, title: model.displayName(for: row), summary: model.activitySummary(for: row),
                           match: model.historySearchQuery == model.query ? model.historyMatches[row.id].map { $0.role.capitalized + ": " + $0.excerpt } : nil,
                           pinned: model.pinned.contains(row.id))
            .accessibilityElement(children: .combine)
    }
}

struct SessionDetail: View {
    @EnvironmentObject var model: AppModel
    let row: Session
    @ViewState private var tab = "Overview"
    @ViewState private var confirmFresh = false
    @ViewState private var showSessionInfo = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SessionStatusBadge(state: row.state)
                Spacer()
                AgentBadge(provider: row.provider)
                if row.simulated { Text("SIMULATED SESSION").font(.caption.bold()).foregroundStyle(.purple) }
            }.font(.subheadline.bold())
            HStack(alignment: .top) {
                Text(model.displayName(for: row)).font(.system(size: 20, weight: .semibold, design: .rounded)).lineLimit(2).textSelection(.enabled)
                Spacer()
                Button { model.beginRename(row) } label: { Image(systemName: "pencil") }
                    .help("Rename session").accessibilityLabel("Rename session")
            }
            VStack(alignment: .leading, spacing: 5) {
                Label(row.project, systemImage: "folder").font(.system(size: 12, weight: .medium)).foregroundStyle(HuddleStyle.accent)

            }
            if row.state == .disconnected {
                Text("Check the agent or locate its terminal before resuming. Recorded history is still available below.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ViewThatFits(in: .horizontal) {
                HStack { terminalButton; secondaryActions }
                VStack(alignment: .leading, spacing: 8) { terminalButton; secondaryActions }
            }
            if !row.simulated { RepositoryContextView(directory: row.cwd) }
            Picker("Detail", selection: $tab) {
                Text("Overview").tag("Overview")
                Text("Handoff").tag("Handoff")
            }.pickerStyle(.segmented).labelsHidden()
            if tab == "Overview" {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if row.state == .needsInput { AttentionRequestCard(row: row) }
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Latest activity").font(.system(size: 14, weight: .semibold))
                                if let context = model.contexts[row.id] {
                                    Text("Updated \(context.updated, style: .relative) ago")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Button { Task { await model.appendHistory(row) } } label: { Image(systemName: "arrow.clockwise") }
                                .disabled(row.simulated || model.historyLoading.contains(row.id)).help("Refresh recorded activity")
                        }
                        if model.historyLoading.contains(row.id) { ProgressView("Loading recorded activity…").controlSize(.small) }
                        if let failure = model.historyErrors[row.id] {
                            Text("Could not refresh activity. \(failure)").font(.caption).foregroundStyle(.orange)
                        }
                        if let context = model.contexts[row.id] {
                            if (context.sessionUpdated ?? 0) < row.updated {
                                Text("New session activity since this snapshot.").font(.caption).foregroundStyle(.secondary)
                            }
                            activityField("LATEST RESPONSE", context.latestResponse ?? "No recent response available.")
                            DisclosureGroup("Latest request") {
                                Text(HuddleStyle.inline(context.latestRequest ?? "No recent request available."))
                                    .font(.callout).textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
                            }.font(.callout)

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
                HandoffEditor(row: row) { confirmFresh = true }
            }
            Spacer(minLength: 0)
        }.padding(18)
        .task(id: row.id + ":" + tab) {
            await model.appendHistory(row)
        }
        .confirmationDialog("Start a new \(row.provider) session with this handoff?", isPresented: $confirmFresh) {
            Button("Start fresh in Terminal") { Task { await model.fresh(row) } }
        } message: { Text("The edited handoff will be sent as the first prompt. Your original session stays available.") }
    }
    private var terminalButton: some View {
                Button { model.resume(row) } label: {
                    HStack(spacing: 6) {
                        if model.navigatingTerminal { ProgressView().controlSize(.small) }
                        Text(model.navigatingTerminal ? model.terminalProgress : model.terminalActionTitle(for: row))
                    }
                }
                    .buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                    .disabled(row.simulated || row.state == .archived || model.navigatingTerminal)
    }
    private var secondaryActions: some View {
        HStack {
                Button { NSWorkspace.shared.open(URL(fileURLWithPath: row.cwd)) } label: { Image(systemName: "folder") }
                    .help("Open project folder").disabled(row.simulated || row.cwd.isEmpty)
                Button { model.togglePin(row) } label: { Image(systemName: model.pinned.contains(row.id) ? "pin.fill" : "pin") }
                    .help(model.pinned.contains(row.id) ? "Unpin session" : "Pin session")
                cleanupMenu
        }
    }
    private var cleanupMenu: some View {
        Menu {
            Button("Rename…") { model.beginRename(row) }
            Button(model.notificationPreferences.mutedProjects.contains(row.cwd) ? "Unmute project alerts" : "Mute project alerts") { model.muteProject(row) }.disabled(row.cwd.isEmpty)
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
        RecordedMessageCard(title: title, value: value)
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
