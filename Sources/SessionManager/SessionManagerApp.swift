import SwiftUI
import SessionCore

@main struct SessionManagerApp: App {
    @NSApplicationDelegateAdaptor(EmbeddedTerminalAppDelegate.self) private var terminalDelegate
    @AppStorage("appAccentColor") private var appAccent = ""
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    @ObservedObject private var terminalPreferences = TerminalPreferences.shared
    @StateObject private var model = AppModel()
    @StateObject private var loginItem = LoginItem()
    @StateObject private var updater = AppUpdater()
    @StateObject private var switcher = SessionSwitcherController()
    private var titleBarLogo: some View {
        Image(nsImage: RunHuddleIcon.image(size: 24, appTile: true))
            .resizable().frame(width: 24, height: 24)
            .accessibilityHidden(true)
    }
    var body: some Scene {
        Window("RunHuddle", id: "main") {
            ContentView().environmentObject(model).environmentObject(updater)
                .onAppear {
                    EmbeddedTerminals.shared.restore(model: model)
                    switcher.start(model: model, loginItem: loginItem, updater: updater)
                    model.onTerminalOpened = { [weak switcher] in switcher?.terminalDidOpen() }
                }
                .frame(minWidth: 760, minHeight: 640)
                .preferredColorScheme(terminalPreferences.value.appColorScheme(appearance: appearance))
                .disclosureGroupStyle(HuddleDisclosureStyle())
                .toolbar {
                    if #available(macOS 26.0, *) {
                        ToolbarItem(placement: .navigation) { titleBarLogo }
                            .sharedBackgroundVisibility(.hidden)
                    } else {
                        ToolbarItem(placement: .navigation) { titleBarLogo }
                    }
                }

        }
        .windowStyle(.titleBar)
        .windowResizability(.contentMinSize)
        .defaultSize(width: 1320, height: 820)
        .commands {
            CommandGroup(after: .appInfo) { UpdateButton().environmentObject(updater) }
            SearchSessionCommands()
            WorkspaceViewCommands()
            RunHuddleHelpCommands()
        }
        Window("Getting started", id: "getting-started") {
            GettingStartedView().environmentObject(model).environmentObject(updater)
                .preferredColorScheme(terminalPreferences.value.appColorScheme(appearance: appearance))
                .disclosureGroupStyle(HuddleDisclosureStyle())
        }.windowResizability(.contentSize)
        Window("Icon guide", id: "icon-guide") {
            ScrollView { SessionIconGuide().padding(24) }
                .frame(width: 400, height: 520)
                .preferredColorScheme(terminalPreferences.value.appColorScheme(appearance: appearance))
        }.windowResizability(.contentSize)
        Settings {
            TabView(selection: $model.settingsTab) {
                GeneralSettings().environmentObject(switcher.hotKey).environmentObject(updater).environmentObject(loginItem).tabItem { Label("General", systemImage: "gearshape") }.tag("general")
                AppearanceSettings().tabItem { Label("Appearance", systemImage: "paintpalette") }.tag("appearance")
                AgentSetupView(embeddedInSettings: true).environmentObject(model).tabItem { Label("Connections", systemImage: "link") }.tag("connections")
                TerminalSettings().tabItem { Label("Terminal", systemImage: "terminal") }.tag("terminal")
                NotificationSettingsView().environmentObject(model).tabItem { Label("Notifications", systemImage: "bell") }.tag("notifications")
            }
                .background(SettingsWindowTracker())
                .preferredColorScheme(terminalPreferences.value.appColorScheme(appearance: appearance))
                .disclosureGroupStyle(HuddleDisclosureStyle())
        }
    }
}


struct ContentView: View {
    @AppStorage("appAccentColor") private var appAccent = ""
    @ObservedObject private var terminalPreferences = TerminalPreferences.shared
    @ObservedObject private var embeddedTerminals = EmbeddedTerminals.shared
    @EnvironmentObject var model: AppModel
    @Environment(\.openWindow) var openWindow
    @Environment(\.openSettings) private var openSettings
    @AppStorage("showGettingStartedAtStartup") private var showGuideAtStartup = true
    @ViewState private var didCheckStartupGuide = false
    @AppStorage("sessionInfoVisible") private var showSessionInfo = false
    @ViewState private var showDetails = false
    @AppStorage("expandedSession") private var expandedSession = false
    @ViewState private var lastSessionFilter = "Running here"
    private var hasSessionFilters: Bool { model.provider != "All tools" || model.projectFilter != "All projects" }
    private var isNow: Bool { model.filter == "Running here" && model.query.isEmpty }
    @ViewState private var showNewSession = false
    @ViewState private var showNewShell = false
    @ViewState private var confirmTerminalResume = false
    @ViewState private var bulkGeneration: BulkGenerationRequest?
    @FocusState private var searchFocused: Bool
    @FocusState private var listFocused: Bool
    private var workspaceSubtitle: String {
        if isNow { return "Your sessions running inside RunHuddle." }
        if model.filter == "Running elsewhere" { return "Running outside RunHuddle · activity is read-only." }
        let shells = model.shellTerminals(filter: model.filter)
        let count = model.visible.count
        if !shells.isEmpty { return "\(count) sessions · \(shells.count) shell \(shells.count == 1 ? "terminal" : "terminals")" }
        let projects = model.projects
        return "\(count) " + (count == 1 ? "session" : "sessions") + " across \(projects) " + (projects == 1 ? "project" : "projects")
    }
    @ViewBuilder private var workspaceContent: some View {

            if model.filter == "Saved work" { SavedWorkLibrary() } else {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    SessionFilterMenu()
                    VStack(alignment: .leading, spacing: 5) {
                        if model.isSearching || !["Running here", "Running elsewhere", "All sessions", "Pinned", "Archived"].contains(model.filter) {
                            Text(model.isSearching ? "Search results" : model.filter).font(.headline)
                        }
                        Text(workspaceSubtitle)
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        if isNow { ActivityOverview(sessions: model.visible) }
                        if model.filter == "Archived" && !model.visible.isEmpty {
                            Text(SessionStorageTotal(model.visible).label)
                                .font(.caption).foregroundStyle(.secondary)
                                .help("Allocated space for available primary transcript files in these results. Shared files counted once. Excludes project files, attachments, agent indexes, and RunHuddle’s library. APFS shared blocks may not be uniquely reclaimable.")
                        }
                    }
                    Spacer()
                    workspacePaneControls
                    if model.cleaning || model.manualRefreshing { ProgressView().controlSize(.small) }
                }.padding(.horizontal, 20).padding(.vertical, 8)
                    .background(LinearGradient(colors: [HuddleStyle.accent.opacity(0.035), .clear], startPoint: .topLeading, endPoint: .bottomTrailing))
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
                SessionColumns(showDetails: showDetails, expanded: expandedSession) { sessionList } detail: { sessionDetailPane }
                if model.cleaning && !model.cleanupProgress.isEmpty {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(model.cleanupProgress).font(.caption).foregroundStyle(.secondary)
                        Spacer()
                    }.padding(12)
                }
                if let message = model.cleanupMessage {
                    HStack {
                        Text(message).lineLimit(2).help(message)
                        Spacer()
                        Button { model.cleanupMessage = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).help("Dismiss cleanup result")
                    }.font(.caption).foregroundStyle(.secondary).padding(12)
                }
            }
            }

    }
    private var workspacePaneControls: some View {
        WorkspacePaneControls(
            listVisible: !showDetails || !expandedSession,
            infoVisible: showSessionInfo && showDetails && model.selected != nil,
            canToggleList: showDetails,
            canToggleInfo: model.selected != nil && showDetails,
            toggleList: { expandedSession.toggle() },
            toggleInfo: { showSessionInfo.toggle() }
        )
    }
    @ViewBuilder private var sessionList: some View {

                    VStack(spacing: 0) {
                        if ["All sessions", "Running here"].contains(model.filter), ["All tools", "Shell"].contains(model.provider),
                           !model.shellTerminals(filter: model.filter).isEmpty || (model.query.isEmpty && model.projectFilter == "All projects") {
                            ShellTerminalsEntry(matching: model.shellTerminals(filter: model.filter))
                        }
                        ForEach(embeddedTerminals.sessions.filter { !$0.isShell && $0.row(in: model) == nil && ["Running here", "All sessions"].contains(model.filter) && (model.filter != "Running here" || !$0.ended) }) { terminal in
                            UnmatchedTerminalRow(session: terminal)
                        }

                        if !model.query.isEmpty {
                            HStack(spacing: 8) {
                                Button("Clear search") { model.query = ""; model.libraryQuery = ""; searchFocused = false }
                                Picker("Search scope", selection: $model.searchScope) {
                                    ForEach(SessionSearchScope.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                                }.labelsHidden().fixedSize().help("Search all sessions includes archived sessions; tool and project filters still apply")
                                if model.searchingHistory { ProgressView().controlSize(.small) }
                                Text(model.historySearchStatus).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                Spacer(minLength: 0)
                            }.padding(.horizontal, 16).padding(.top, 8)
                            Text(model.searchScope == .everywhere ? "All session states · includes archived sessions · selected filters apply" : "\(model.filter) · \(model.provider) · \(model.projectFilter == "All projects" ? "All projects" : ProjectFilter.title(model.projectFilter))")
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
                                    Button("Generate handoffs…") { generateBulk(summaries: false) }
                                    Button("Save project notes…") { generateBulk(summaries: true) }
                                }.disabled(model.bulkSelection.isEmpty)
                                HStack {
                                    Button("Archive…") { bulk("archive") }
                                    Button("Restore…") { bulk("restore") }
                                    Menu("Delete…") {
                                        Button("Archive and delete…", role: .destructive) { bulk("archive-delete") }
                                        Button("Delete archived…", role: .destructive) { bulk("delete") }
                                    }.help("Review removal of closed histories. Running and uncertain sessions are skipped.")
                                }.disabled(model.bulkSelection.isEmpty)
                            }.padding(12).disabled(model.cleaning)
                        } else {
                            HStack {
                                Spacer()
                                Button { model.bulkMode = true } label: {
                                    Label("Bulk actions", systemImage: "checklist")
                                        .font(.caption).foregroundStyle(.secondary)
                                }.buttonStyle(.plain).disabled(model.cleaning)
                                    .help("Select sessions for handoffs, summaries, archiving, restoring, or deletion")
                            }.padding(.horizontal, 16).frame(height: 28)
                        }
                        ScrollViewReader { proxy in
                        ScrollView {
                        LazyVStack(alignment: .leading, spacing: 4) {
                            if model.filter == "Running here" && model.query.isEmpty {
                                ForEach(nowSections, id: \.title) { section in
                                    Section { sessionCells(section.rows) } header: {
                                        HStack {
                                            Text(section.title).font(.system(size: 11, weight: .semibold))
                                            Text("\(section.rows.count)").font(.system(size: 10)).foregroundStyle(.secondary)
                                            Spacer()
                                        }.foregroundStyle(.secondary).padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 2)
                                    }
                                }
                            } else {
                                sessionCells(model.chainListRows)
                            }
                        }.padding(.vertical, 4)
                        }.defaultScrollAnchor(.top)
                        .focusable().focused($listFocused).focusEffectDisabled()
                        .onMoveCommand { direction in
                            guard !searchFocused, direction == .up || direction == .down else { return }
                            let rows = model.filter == "Running here" && model.query.isEmpty ? nowSections.flatMap(\.rows) : model.chainListRows
                            guard !rows.isEmpty else { return }
                            let index = rows.firstIndex { $0.id == model.selection } ?? (direction == .down ? -1 : rows.count)
                            let next = min(max(index + (direction == .down ? 1 : -1), 0), rows.count - 1)
                            model.selection = rows[next].id
                            showDetails = true
                            proxy.scrollTo(rows[next].id)
                        }
                        .overlay {
                            if model.visible.isEmpty && model.shellTerminals(filter: model.filter).isEmpty {
                                ContentUnavailableView {
                                    Label(model.filter == "Running here" ? (hasSessionFilters ? "No active sessions match these filters" : "No active sessions") : "No matching sessions", systemImage: "magnifyingglass")
                                } description: {
                                    Text(hasSessionFilters ? "Try removing a filter or view matching session history." : "Browse previous sessions or start work in your preferred agent.")
                                } actions: {
                                    if hasSessionFilters {
                                        Button("Clear filters") { model.provider = "All tools"; model.projectFilter = "All projects" }
                                    }
                                    Button(hasSessionFilters ? "View matching history" : "Browse all sessions") { model.filter = "All sessions"; model.searchScope = .everywhere }
                                }
                            }
                        }
                        }
                    }.background(HuddleStyle.canvas)

    }
    @ViewBuilder private var sessionDetailPane: some View {

                        VStack(spacing: 0) {
                            if embeddedTerminals.presentedID == EmbeddedTerminals.shellWorkspaceID || embeddedTerminals.sessions.contains(where: { $0.isShell && $0.id == embeddedTerminals.presentedID }) {
                                ShellTerminalTabs()
                            } else if let id = embeddedTerminals.presentedID,
                               let owned = embeddedTerminals.sessions.first(where: { $0.id == id }),
                               owned.row(in: model) == nil {
                                EmbeddedTerminalContent(session: owned).id(id)
                            } else if let row = model.selected { SessionDetail(row: row).id(row.id) }
                            else { ContentUnavailableView("Choose a session", systemImage: "rectangle.stack", description: Text("Review its status, resume work, or prepare a handoff.")) }
                        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(HuddleStyle.panel)

    }
    private func generateBulk(summaries: Bool) {
        let rows = model.sessions.filter { model.bulkSelection.contains($0.id) && !$0.simulated }
        bulkGeneration = BulkGenerationRequest(summaries: summaries, sessions: rows)
    }
    private func bulk(_ operation: String) {
        let rows = model.sessions.filter { model.bulkSelection.contains($0.id) }
        Task { await model.prepareBulkCleanup(operation, rows: rows) }
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Menu {
                    Button("New AI session…") { showNewSession = true }
                    Button("Open terminal…") { showNewShell = true }
                } label: { Label("New session", systemImage: "plus") } primaryAction: { showNewSession = true }
                    .menuStyle(.borderlessButton).fixedSize().padding(.horizontal, 10).padding(.vertical, 7)
                    .background(HuddleStyle.accent.opacity(0.2), in: RoundedRectangle(cornerRadius: 7)).padding(.leading, 16)
                WorkspaceNavigation(selection: model.filter, count: { model.count(for: $0) }, select: selectDestination, returnToSessions: { selectDestination(lastSessionFilter) })
                AttentionInboxButton().padding(.trailing, 16)
            }
            Divider()
            workspaceContent
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    if SettingsWindowTracker.closeIfVisible() { return }
                    if model.connectionNeedsAttention { model.settingsTab = "connections" }
                    openSettings()
                } label: {
                    Image(systemName: "gearshape")
                        .foregroundStyle(model.connectionNeedsAttention ? Color.orange : .secondary)
                }.help(model.connectionNeedsAttention ? "Settings — connections need attention" : "Settings")
                    .accessibilityLabel("Settings")
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Icon guide…") { openWindow(id: "icon-guide") }
                    Button("Getting started…") { openWindow(id: "getting-started") }
                    #if DEBUG
                    Toggle("Show demo sessions", isOn: $model.showDemo)
                        .onChange(of: model.showDemo) { _, enabled in if enabled { model.seedDemo() } }
                    #endif
                    Divider()
                    Text("RunHuddle \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development")")
                } label: { Label("Help", systemImage: "questionmark.circle") }
            }
            ToolbarItem(placement: .primaryAction) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField(model.filter == "Saved work" ? "Search notes" : "Search sessions", text: Binding(get: { model.filter == "Saved work" ? model.libraryQuery : model.query }, set: { if model.filter == "Saved work" { model.libraryQuery = $0 } else { model.query = $0 } }))
                        .textFieldStyle(.plain).focused($searchFocused)
                        .onExitCommand { model.query = ""; model.libraryQuery = ""; searchFocused = false }
                        .accessibilityLabel(model.filter == "Saved work" ? "Search notes" : "Search sessions, projects, and messages")
                    if !(model.filter == "Saved work" ? model.libraryQuery : model.query).isEmpty {
                        Button { if model.filter == "Saved work" { model.libraryQuery = "" } else { model.query = "" }; searchFocused = true } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).foregroundStyle(.secondary)
                            .help("Clear search (Escape)").accessibilityLabel("Clear search")
                    }
                }.padding(.horizontal, 8).frame(width: 210, height: 28)
                    .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 7))
                    .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(searchFocused ? HuddleStyle.accent : .clear))
                    .help(model.filter == "Saved work" ? "Search notes (⌘F)" : "Search sessions (⌘F)")
            }

        }
        .sheet(isPresented: $showNewShell) {
            NewShellTerminalView(initialDirectory: embeddedTerminals.sessions.first { $0.id == embeddedTerminals.presentedID }?.directory ?? model.selected?.cwd ?? "")
        }
        .sheet(isPresented: $showNewSession) { NewSessionLaunchView(initialDirectory: model.selected?.cwd ?? "") }
        .focusedSceneValue(\.searchSessions, { searchFocused = true })
        .focusedSceneValue(\.workspaceViewActions, WorkspaceViewActions(
            listVisible: !showDetails || !expandedSession,
            infoVisible: showSessionInfo && showDetails && model.selected != nil,
            canToggleList: showDetails && model.filter != "Saved work",
            canToggleInfo: model.selected != nil && showDetails && model.filter != "Saved work",
            canRefresh: !model.manualRefreshing && !model.cleaning,
            toggleList: { expandedSession.toggle() },
            toggleInfo: { showSessionInfo.toggle() },
            refresh: { Task { await model.refresh(userInitiated: true) } }
        ))
        .tint(HuddleStyle.accent)
        .background(HuddleStyle.canvas)
        .alert("RunHuddle", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK") { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await model.refreshNotificationStatus() }
        }
        .onChange(of: embeddedTerminals.presentedID) { _, id in
            if let id { model.openEmbeddedTerminal?(id) }
        }
        .onChange(of: model.sessions) { _, _ in
            model.synchronizePresentedTerminalSelection()
        }
        .onChange(of: model.query) { _, _ in model.scheduleHistorySearch() }
        .onAppear {
            if !didCheckStartupGuide {
                didCheckStartupGuide = true
                if showGuideAtStartup { openWindow(id: "getting-started") }
            }
            model.openMainWindow = { showDetails = true; openWindow(id: "main") }
            model.openEmbeddedTerminal = { id in
                embeddedTerminals.presentedID = id
                model.filter = "All sessions"; model.query = ""; model.provider = "All tools"; model.projectFilter = "All projects"
                model.synchronizePresentedTerminalSelection()
                showDetails = true
                openWindow(id: "main")
            }
            model.openSettingsWindow = { openSettings() }
            // Restoration can finish before this view installs its callbacks.
            if let id = embeddedTerminals.presentedID { model.openEmbeddedTerminal?(id) }
        }
        .sheet(item: $bulkGeneration) { BulkGenerationView(request: $0) }
        .sheet(item: $model.workSource) { row in WorkSummaryComposer(source: row, title: model.displayName(for: row)) }
        .sheet(item: $model.bulkReview) { BulkCleanupView(review: $0) }
        .sheet(isPresented: $model.showSetup) { AgentSetupView() }
        .sheet(item: $model.renameSession) { row in
            VStack(alignment: .leading, spacing: 16) {
                Text("Rename session").font(.title2.bold())
                Text("This name is used in RunHuddle. The same name appears above its RunHuddle terminal.")
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
        let groups = model.chainGroups
        let earlierIDs = Set(groups.values.flatMap { $0.map(\.id) })
        ForEach(rows) { row in
            HStack {
                if model.bulkMode {
                    Toggle("Select session", isOn: Binding(
                        get: { model.bulkSelection.contains(row.id) },
                        set: { if $0 { model.bulkSelection.insert(row.id) } else { model.bulkSelection.remove(row.id) } }
                    )).labelsHidden().toggleStyle(.checkbox).disabled(row.simulated || model.cleaning)
                }
                Button { if let shell = embeddedTerminals.shell(containing: row, model: model) { model.presentEmbedded(shell.id) }
                        else { embeddedTerminals.presentedID = nil; model.selection = row.id; showDetails = true; searchFocused = false; listFocused = true } } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        SessionRow(row: row)
                        if let shell = embeddedTerminals.shell(containing: row, model: model) {
                            Label("In terminal · " + shell.title, systemImage: "terminal")
                                .font(.caption).foregroundStyle(HuddleStyle.accent).lineLimit(1).padding(.horizontal, 12).padding(.bottom, 6)
                        }
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(model.selection == row.id ? .isSelected : [])
            }.padding(.leading, earlierIDs.contains(row.id) ? 20 : 0)
                .modifier(SessionCardSurface(selected: model.selection == row.id))
                .background {
                    // Keep the entire card, including its padding, selectable.
                    Color.clear.contentShape(Rectangle()).onTapGesture {
                        if let shell = embeddedTerminals.shell(containing: row, model: model) { model.presentEmbedded(shell.id) }
                        else { embeddedTerminals.presentedID = nil; model.selection = row.id; showDetails = true; searchFocused = false; listFocused = true }
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 2)
                .id(row.id).contextMenu {
                Button(model.pinned.contains(row.id) ? "Unpin session" : "Pin session") { model.togglePin(row) }
                Button("Rename…") { model.beginRename(row) }
                if model.displayNames[row.id] != nil {
                    Button("Reset to original name") { model.saveDisplayName("", for: row) }
                }
                Divider()
                Button(model.handoffs[row.id] == nil ? "Generate handoff…" : "Update handoff…") {
                    bulkGeneration = BulkGenerationRequest(summaries: false, sessions: [row])
                }.disabled(row.simulated || model.cleaning || model.handoffGenerating.contains(row.id))
                Button("Save as project note…") { model.workError = nil; model.workSource = row }.disabled(row.simulated || model.cleaning)
                Divider()
                if row.state == .archived {
                    Button("Restore…") { Task { await model.prepareBulkCleanup("restore", rows: [row]) } }
                        .disabled(row.simulated || model.cleaning)
                } else {
                    Button("Archive…") { Task { await model.prepareBulkCleanup("archive", rows: [row]) } }
                        .disabled(row.simulated || model.cleaning || row.state != .saved)
                    Button("Archive and delete…", role: .destructive) { Task { await model.prepareBulkCleanup("archive-delete", rows: [row]) } }
                        .disabled(row.simulated || model.cleaning || row.state != .saved)
                    if row.state != .saved { Text("Session must be confirmed closed before archiving") }
                }
            }
            if let earlier = groups[row.id], !earlier.isEmpty {
                Button {
                    if !model.expandedChains.insert(row.id).inserted {
                        model.expandedChains.remove(row.id)
                        if earlier.contains(where: { $0.id == model.selection }) { model.selection = row.id }
                    }
                } label: {
                    Label("\(earlier.count) earlier \(earlier.count == 1 ? "session" : "sessions")", systemImage: model.expandedChains.contains(row.id) ? "chevron.down" : "chevron.right")
                        .font(.caption).foregroundStyle(.secondary)
                }.buttonStyle(.plain)
                    .padding(.leading, 34).padding(.trailing, 14).padding(.bottom, 8)
            }
        }
    }
    private func saveRename(_ row: Session) {
        guard !model.renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if model.saveDisplayName(model.renameText, for: row) { model.renameSession = nil }
    }
    private func selectDestination(_ destination: String) {
        if model.filter != "Saved work" { lastSessionFilter = model.filter }
        embeddedTerminals.presentedID = nil
        model.query = ""; model.filter = destination
        if destination == "Saved work" { model.workError = nil }
        else { lastSessionFilter = destination }
        showDetails = false; searchFocused = false; listFocused = destination != "Saved work"
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
    @Environment(\.openWindow) private var openWindow
    @ObservedObject private var embeddedTerminals = EmbeddedTerminals.shared
    @ViewState private var terminalFailure: String?
    @EnvironmentObject var model: AppModel
    let row: Session

    @ViewState private var tab = "Activity"
    @ViewState private var changesOpen = false
    @ViewState private var showingChanges = false
    @ViewState private var infoInline = true
    @ViewState private var reviewPaths: Set<String>?
    private var owned: EmbeddedAgentSession? { embeddedTerminals.sessions.last { $0.row(in: model)?.id == row.id } }
    @ViewState private var confirmStop = false
    @ViewState private var showContinuation = false
    @ViewState private var reviewWithAgent = false
    @ViewState private var repository: RepositoryContext?
    @ViewState private var repositoryLoading = false
    @ViewState private var repositoryRefresh = UUID()
    @AppStorage("sessionInfoVisible") private var showSessionInfo = false
    @AppStorage("showAgentChecklists") private var showAgentChecklists = true
    var body: some View {
        GeometryReader { geometry in
            let inlineInfo = geometry.size.width >= 850
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Button { showingChanges = false; tab = owned == nil ? "Activity" : "Terminal" } label: {
                        HStack(spacing: 6) {
                            Image(systemName: owned == nil ? "text.bubble" : "terminal")
                            Text(changesOpen ? (owned == nil ? "Conversation" : "Terminal") : model.displayName(for: row)).lineLimit(1).truncationMode(.tail)
                        }.font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 8).padding(.vertical, 7)
                            .frame(maxWidth: 360, alignment: .leading)
                            .background(HuddleStyle.accent.opacity(showingChanges ? 0.04 : 0.15), in: RoundedRectangle(cornerRadius: 7))
                    }.buttonStyle(.plain).help(model.displayName(for: row))
                        .accessibilityLabel((owned == nil ? "Activity: " : "Terminal: ") + model.displayName(for: row))
                        .accessibilityAddTraits(showingChanges ? [] : .isSelected)
                    if changesOpen {
                        HStack(spacing: 4) {
                            Button { showingChanges = true } label: {
                                Label("Project changes", systemImage: "doc.text.magnifyingglass").lineLimit(1)
                            }.buttonStyle(.plain)
                                .accessibilityAddTraits(showingChanges ? .isSelected : [])
                            Button { showingChanges = false; changesOpen = false } label: {
                                Image(systemName: "xmark").frame(width: 22, height: 24)
                            }.buttonStyle(.plain).help("Close project changes").accessibilityLabel("Close project changes")
                        }.font(.system(size: 13, weight: .semibold))
                            .padding(.leading, 8).padding(.trailing, 4).padding(.vertical, 3)
                            .background(HuddleStyle.accent.opacity(showingChanges ? 0.15 : 0.04), in: RoundedRectangle(cornerRadius: 7))
                            .help("Project changes · " + row.cwd)
                    }
                    Spacer(minLength: 4)
                    if row.state == .saved && !showingChanges {
                        Button("Resume this session") { model.resume(row) }
                            .buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                            .disabled(row.simulated || model.navigatingTerminal)
                            .help("Reopen the same conversation with its existing context")
                    }
                    Image(systemName: row.state.symbol).foregroundStyle(row.state.color)
                        .frame(width: 28, height: 28).help(row.state.title).accessibilityLabel(row.state.title)
                    cleanupMenu
                }
                // Keep the terminal mounted when the info panel is toggled.
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        VStack(spacing: 0) {
                        if tab == "Activity" {
                            ConversationActivity(row: row)
                        } else if tab == "Terminal", let owned {
                            EmbeddedTerminalContent(session: owned, compact: true).id(owned.id)
                        }
                        }.opacity(showingChanges ? 0 : 1)
                            .allowsHitTesting(!showingChanges).accessibilityHidden(showingChanges)
                        if changesOpen {
                            ProjectChangesView(directory: row.cwd, review: { paths in
                                reviewPaths = paths; reviewWithAgent = true; showContinuation = true
                            })
                            .opacity(showingChanges ? 1 : 0)
                            .allowsHitTesting(showingChanges).accessibilityHidden(!showingChanges)
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    if showSessionInfo && inlineInfo {
                        Divider()
                        sessionInfo.frame(width: 300)
                    }
                }
            }.padding(10)
                .onChange(of: inlineInfo, initial: true) { _, value in infoInline = value }
                .popover(isPresented: Binding(get: { showSessionInfo && !inlineInfo }, set: { showSessionInfo = $0 }), arrowEdge: .trailing) {
                    sessionInfo.frame(width: 340, height: 520).padding(16)
                }
        }
        .alert("End this session?", isPresented: $confirmStop) {
            Button("Cancel", role: .cancel) {}
            Button("End session", role: .destructive) { owned?.stop() }
            if let owned {
                Button("End and archive…", role: .destructive) { model.endAndReviewArchive(owned, row: row) }
            }
        } message: { Text("This stops the agent and may interrupt work. End and archive opens an archive review after the agent stops. Recorded history remains available to resume.") }
        .task(id: row.id + ":" + tab) {
            if tab == "Activity" { await model.appendHistory(row) }
        }
        .task(id: row.cwd + repositoryRefresh.uuidString + String(showSessionInfo)) {
            repository = nil
            repositoryLoading = false
            guard showSessionInfo, !row.simulated else { return }
            repositoryLoading = true
            do {
                let result = try await RepositoryContext.read(at: row.cwd)
                guard !Task.isCancelled else { return }
                repository = result
            } catch {
                guard !Task.isCancelled else { return }
            }
            repositoryLoading = false
        }
        .onAppear { if owned != nil { tab = "Terminal" } }
        .onChange(of: owned?.id) { _, value in tab = value == nil ? "Activity" : "Terminal" }
        .sheet(isPresented: $showContinuation) {
            if reviewWithAgent { ProjectReviewView(row: row, initialPaths: reviewPaths) }
            else { HandoffEditor(row: row) }
        }

    }
    private var sessionInfo: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Session info").font(.headline)
                    Spacer()
                    Button { showSessionInfo = false } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).accessibilityLabel("Close session info")
                }
                HStack {
                    Text(row.provider).font(.subheadline)
                    Spacer()
                    SessionStatusBadge(state: row.state)
                }
                Text(SessionPresentation.statusSummary(row)).font(.caption).foregroundStyle(.secondary)
                if showAgentChecklists {
                    if let plan = row.agentPlan { AgentPlanView(plan: plan, sessionState: row.state) }
                    else {
                        DisclosureGroup("No agent checklist reported") {
                            Text("This agent hasn’t recorded a supported structured plan. Plans written only in conversation text don’t appear here.")
                                .font(.caption).foregroundStyle(.secondary)
                        }.font(.caption).foregroundStyle(.secondary)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Label(row.project, systemImage: "folder").font(.subheadline.bold())
                    Text(row.cwd).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        model.notesProjectFilter = row.cwd; model.libraryQuery = ""
                        model.filter = "Saved work"
                    } label: {
                        Label("Project notes (\(model.savedWork.filter { $0.belongs(to: row.cwd) }.count))", systemImage: "note.text")
                    }.buttonStyle(.bordered)
                    Button("Save as project note…") { model.workError = nil; model.workSource = row }
                        .disabled(row.simulated)
                    ProjectShortcutView(directory: row.cwd)
                    OpenProjectEditorButton(directory: row.cwd, disabled: row.simulated)
                        .buttonStyle(.bordered)
                    HStack {
                        Button("Show in Finder") { NSWorkspace.shared.open(URL(fileURLWithPath: row.cwd)) }
                        Button("Copy path") { model.copy(row.cwd) }
                    }.font(.caption).disabled(row.simulated || row.cwd.isEmpty)
                }
                if !row.simulated {
                    RepositoryContextView(context: repository, loading: repositoryLoading, directory: row.cwd,
                                          refresh: { repositoryRefresh = UUID() }, openChanges: {
                        changesOpen = true; showingChanges = true
                        if !infoInline { showSessionInfo = false }
                    })
                }
                Divider()
                if row.state == .saved {
                    Button("Resume this session") { model.resume(row) }
                        .buttonStyle(.borderedProminent).tint(HuddleStyle.action)
                        .disabled(row.simulated || model.navigatingTerminal)
                    Text("Reopen the same conversation with its existing context.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button("Start fresh with a handoff…") {
                    reviewWithAgent = false
                    showSessionInfo = false
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(200))
                        showContinuation = true
                    }
                }.buttonStyle(.bordered).disabled(row.simulated)
                Text("Review a summary, then start a separate conversation.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Start a review with another agent…") {
                    reviewPaths = nil; reviewWithAgent = true
                    showSessionInfo = false
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(200))
                        showContinuation = true
                    }
                }.font(.caption).disabled(row.simulated)
                SessionChainSummary(row: row)
                DisclosureGroup("Your notes") {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Session purpose", text: Binding(get: { model.briefs[row.id]?.purpose ?? "" }, set: { value in
                            var brief = model.briefs[row.id] ?? SessionBrief(); brief.purpose = value; model.setBrief(brief, for: row)
                        }), axis: .vertical).textFieldStyle(.roundedBorder)
                        TextField("Next step or blocker", text: Binding(get: { model.briefs[row.id]?.nextStep ?? "" }, set: { value in
                            var brief = model.briefs[row.id] ?? SessionBrief(); brief.nextStep = value; model.setBrief(brief, for: row)
                        }), axis: .vertical).textFieldStyle(.roundedBorder)
                        Text("Saved automatically and included when generating a handoff.").font(.caption).foregroundStyle(.secondary)
                    }.padding(.top, 6)
                }
                if let usage = row.contextUsage, let fraction = usage.fraction {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Context used").font(.subheadline.bold())
                            Spacer()
                            Text("\(Int((fraction * 100).rounded()))%").font(.caption.monospacedDigit())
                        }
                        ProgressView(value: min(max(fraction, 0), 1)).tint(fraction >= 0.85 ? .orange : HuddleStyle.accent)
                        Text("Last reported · " + contextTimestamp(usage.reportedAt)).font(.caption2).foregroundStyle(.secondary)
                    }.help("\(usage.used.formatted()) / \(usage.limit.formatted()) tokens. An estimate from the agent; usage can decrease after compaction.")
                }
                DisclosureGroup("Details") {
                    VStack(alignment: .leading, spacing: 12) {
                        if !row.reason.isEmpty { field("STATUS SOURCE", row.reason) }
                        if !row.branch.isEmpty { field("BRANCH AT SESSION RECORDING", row.branch) }
                        if let compactions = row.compactions {
                            field("COMPACTIONS OBSERVED", "\(compactions.count) · " + compactions.source)
                        }
                        if let storage = row.storage {
                            field("TRANSCRIPT STORAGE", "\(SessionStorage.formatted(storage.allocatedBytes)) on disk")
                                .help("Primary transcript only, excluding project files, attachments, agent indexes, and saved work. File size: \(SessionStorage.formatted(storage.bytes)). APFS blocks may be shared.")
                        }
                        if model.displayNames[row.id] != nil {
                            field("ORIGINAL TITLE", row.title)
                            Button("Reset to original name") { model.saveDisplayName("", for: row) }
                        }
                        field("SESSION ID", row.sessionID)
                        Button("Copy session ID") { model.copy(row.sessionID) }
                    }.padding(.top, 8)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
        }
    }
    private var cleanupMenu: some View {
        Menu {
            if let owned {
                if owned.ended {
                    Button("Close exited terminal") { EmbeddedTerminals.shared.close(owned) }
                } else {
                    Button(owned.stopping ? "Stopping session…" : "End session…", role: .destructive) { confirmStop = true }
                        .disabled(owned.stopping)
                }
            } else if row.state == .saved {
                Button("Resume this session") { model.resume(row) }
                    .disabled(row.simulated || model.navigatingTerminal)
            }
            Divider()

            OpenProjectEditorButton(directory: row.cwd, disabled: row.simulated)
            Button("Open project folder") { NSWorkspace.shared.open(URL(fileURLWithPath: row.cwd)) }.disabled(row.cwd.isEmpty)
            Button(model.pinned.contains(row.id) ? "Unpin session" : "Pin session") { model.togglePin(row) }
            Divider()
            Button("Save as project note…") { model.workError = nil; model.workSource = row }
            Button("Rename…") { model.beginRename(row) }
            Button(model.notificationPreferences.mutedProjects.contains(row.cwd) ? "Unmute project alerts" : "Mute project alerts") { model.muteProject(row) }.disabled(row.cwd.isEmpty)
            Divider()
            if row.state == .archived {
                Button("Restore…") { cleanup("restore") }
                Button(row.provider == "Codex" ? "Delete permanently…" : "Move history to Trash…", role: .destructive) { cleanup("delete") }
            } else {
                Button("Archive…") { cleanup("archive") }.disabled(row.state != .saved)
                Button("Archive and delete…", role: .destructive) { cleanup("archive-delete") }.disabled(row.state != .saved)
                if row.state != .saved { Text("Close the session before archiving") }
            }
        } label: { Image(systemName: "ellipsis").frame(width: 28, height: 28) }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
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
