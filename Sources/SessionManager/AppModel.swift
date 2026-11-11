import AppKit
import Foundation
import SessionCore
import UserNotifications

enum Bridge {
    static var root: String {
        if let path = Bundle.main.resourceURL?.appendingPathComponent("bridge").path,
           FileManager.default.fileExists(atPath: path + "/codex_bridge.py") { return path }
        return FileManager.default.currentDirectoryPath + "/scripts"
    }
    static func run(_ arguments: [String], provider: String = "Codex") async throws -> Data {
        let root = root
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("python/bin/python3").path
        let python = bundled.flatMap { FileManager.default.isExecutableFile(atPath: $0) ? $0 : nil }
            ?? FileManager.default.currentDirectoryPath + "/.venv/bin/python"
        return try await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: python)
            let script = provider == "LocalCleanup" ? "local_cleanup.py" : provider == "HandoffAI" ? "handoff_ai.py" : provider == "Search" ? "history_search.py" : provider == "Copilot" ? "copilot_bridge.py" : provider == "Claude" ? "claude_bridge.py" : "codex_bridge.py"
            process.arguments = ["-E", "-s", "-B", root + "/" + script] + arguments
            process.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())
            let output = Pipe(), errors = Pipe()
            process.standardOutput = output; process.standardError = errors
            try process.run()
            // Drain stdout while running so a large session index cannot fill the pipe.
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                let detail = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "Connection failed"
                let summary = detail.split(separator: "\n").last.map(String.init) ?? "Connection failed"
                throw NSError(domain: provider, code: 1, userInfo: [NSLocalizedDescriptionKey: summary])
            }
            return data
        }.value
    }
}

struct CopilotTrackingStatus: Decodable {
    var configured: Bool
    var lastEvent: Double?
}

@MainActor final class AppModel: ObservableObject {
    @Published var showSetup = false
    @Published var copilotConnectionError: String?
    @Published var connectingCopilot = false
    @Published var copilotConnectionNotice: String? = UserDefaults.standard.bool(forKey: "copilotNoticePending")
        ? "Copilot tracking is ready. New sessions connect automatically. Restart/resume existing sessions to track them too." : nil
    private var attemptedCopilotConnection = false
    private var attemptedClaudeRepair = false
    @Published var claudeRepairError: String?
    @Published var claudeRepairNotice: String? = UserDefaults.standard.bool(forKey: "claudeRepairNoticePending")
        ? "Claude tracking paths were updated. Fully exit already-open Claude processes, then launch Claude again from your shell to reload hooks. Using /resume inside an existing process may retain old paths." : nil
    private struct ClaudeRepairResult: Decodable { let repaired: Bool }
    @Published var sessions: [Session] = []
    @Published var selection: String? {
        didSet {
            guard let selection, !selection.hasPrefix("Claude:demo-") else { return }
            do { try store?.save(selection, key: "selection") }
            catch { self.error = "Could not save selection: \(error.localizedDescription)" }
        }
    }
    @Published var query = ""
    @Published var searchScope = SessionSearchScope.everywhere
    var isSearching: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    @Published var briefs: [String: SessionBrief] = [:]
    @Published var historyMatches: [String: HistoryMatch] = [:]
    @Published var historySearchQuery = ""
    @Published var historySearchStatus = ""
    @Published var searchingHistory = false
    private var searchDebounce: Task<Void, Never>?
    private var searchInFlight = false
    @Published var filter = "Now"
    @Published var projectFilter = "All projects"
    @Published var pinned: Set<String> = []
    @Published var providerErrors: [String: String] = [:]
    @Published var provider = "All tools"
    @Published var showDemo = false
    @Published var refreshing = false
    @Published var manualRefreshing = false
    @Published var connection = "Connecting to Codex…"
    @Published var lastRefresh: Date?
    @Published var error: String?
    @Published var displayNames: [String: String] = [:]
    @Published var renameSession: Session?
    @Published var renameText = ""
    @Published var renameError: String?
    @Published var drafts: [String: String] = [:]
    @Published var savedWork: [SavedWork] = []
    private var savedWorkLoaded = false
    @Published var showSavedWork = false
    @Published var workSource: Session?
    @Published var workError: String?
    @Published var workNotice: String?
    @Published var handoffs: [String: GeneratedHandoff] = [:]
    @Published var handoffCandidates: [String: GeneratedHandoff] = [:]
    @Published var handoffBackups: [String: String] = [:]
    @Published var handoffGenerating: Set<String> = []
    @Published var handoffProgress: [String: String] = [:]
    @Published var handoffErrors: [String: String] = [:]
    @Published var handoffAIProvider: String = UserDefaults.standard.string(forKey: "handoffAIProvider") ?? "Codex" {
        didSet { UserDefaults.standard.set(handoffAIProvider, forKey: "handoffAIProvider") }
    }
    @Published var historyLoading: Set<String> = []
    @Published var contexts: [String: HandoffContext] = [:]
    @Published var historyErrors: [String: String] = [:]
    private var historyTasks: [String: Task<Void, Never>] = [:]
    @Published var settingsTab = "general"
    @Published var notificationPreferences = (UserDefaults.standard.data(forKey: "notificationPreferences").flatMap { try? JSONDecoder().decode(NotificationPreferences.self, from: $0) }) ?? NotificationPreferences() {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(notificationPreferences), forKey: "notificationPreferences") }
    }
    private var pendingAlerts: [String: SessionAlert] = [:]
    private var notificationTask: Task<Void, Never>?
    private var reminded: [String: Double] = [:]
    @Published var notifications = false
    @Published var notificationBlocked = false
    @Published var notificationMessage: String?
    @Published var recentAlerts: [SessionAlert] = []
    @Published var navigatingTerminal = false
    @Published var terminalNavigationSessionID: String?
    @Published var terminalProgress = ""
    @Published var terminalSession: Session?
    @Published var terminalTargets: [TerminalTarget] = []
    private var terminalChoices: [String: TerminalTarget] = [:]
    @Published var terminalMessage = ""
    @Published var bulkMode = false
    @Published var bulkSelection: Set<String> = []
    @Published var bulkReview: BulkCleanupReview?
    @Published var localCleanupState = LocalCleanupState()
    @Published var cleanupPlan: CleanupPlan?
    @Published var cleanupProgress = ""
    @Published var cleaning = false { didSet { if !cleaning { cleanupProgress = "" } } }
    @Published var cleanupMessage: String?
    private var store: Store?
    private var timer: Task<Void, Never>?
    private var hookWatcher: HookEventWatcher?
    private var codexObserver: CodexEventObserver?
    private var processWatcher: AgentProcessWatcher?
    private var exitRefreshTask: Task<Void, Never>?
    private var exitedProviders = Set<String>()
    private var eventRefreshTask: Task<Void, Never>?
    private var pendingProviders = Set<String>()
    private var refreshingProviders = Set<String>()
    private var terminationObserver: NSObjectProtocol?
    private var refreshWaiters: [CheckedContinuation<Void, Never>] = []
    private var connectedProviders: Set<String> = []
    private let attentionDelegate = AttentionDelegate()
    var openMainWindow: (() -> Void)?
    var onTerminalOpened: (() -> Void)?
    var openSettingsWindow: (() -> Void)?

    init() {
        do {
            let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("Agent Session Manager", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            store = try Store(path: folder.appendingPathComponent("sessions.sqlite").path)
            sessions = try store?.load([Session].self, key: "sessions") ?? []
            sessions = Recovery.restore(sessions)
            pinned = try store?.load(Set<String>.self, key: "pinnedSessions") ?? []
            localCleanupState = try store?.load(LocalCleanupState.self, key: "localCleanupState") ?? LocalCleanupState()
            briefs = try store?.load([String: SessionBrief].self, key: "sessionBriefs") ?? [:]
            displayNames = try store?.load([String: String].self, key: "displayNames") ?? [:]
            drafts = try store?.load([String: String].self, key: "drafts") ?? [:]
            contexts = try store?.load([String: HandoffContext].self, key: "handoffContexts") ?? [:]
            handoffs = try store?.load([String: GeneratedHandoff].self, key: "generatedHandoffs") ?? [:]
            savedWork = try store?.load([SavedWork].self, key: "savedWorkLibrary") ?? []
            savedWorkLoaded = true
            handoffBackups = try store?.load([String: String].self, key: "handoffBackups") ?? [:]
            selection = try store?.load(String.self, key: "selection")
        } catch { self.error = "Local storage: \(error.localizedDescription)" }
        attentionDelegate.onSelect = { [weak self] id, goToTerminal in
            guard let self else { return }
            if id == "activity-batch" {
                self.filter = "Now"; self.query = ""; self.provider = "All tools"; self.projectFilter = "All projects"
                self.openMainWindow?(); NSApp.activate(ignoringOtherApps: true)
                return
            }
            self.showSession(id)
            guard goToTerminal, id != "notification-test" else { return }
            Task { @MainActor in
                await self.refresh()
                if let row = self.sessions.first(where: { $0.id == id }) { self.resume(row) }
                else { self.error = "This session is no longer in the current index. No terminal was opened." }
            }
        }
        UNUserNotificationCenter.current().delegate = attentionDelegate
        let actions = [
            UNNotificationAction(identifier: "goToTerminal", title: "Go to terminal", options: [.foreground]),
            UNNotificationAction(identifier: "viewSession", title: "View session", options: [.foreground])
        ]
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "sessionActivity", actions: actions, intentIdentifiers: [])
        ])
        timer = Task { [weak self] in
            await self?.refreshNotificationStatus()
            while !Task.isCancelled {
                await self?.refreshNotificationStatus()
                await self?.refresh()
                try? await Task.sleep(for: .seconds(30))
            }
        }
        let storage = NSHomeDirectory() + "/Library/Application Support/Agent Session Manager/"
        let environment = ProcessInfo.processInfo.environment
        hookWatcher = HookEventWatcher(paths: [
            (environment["SESSION_TRACKER_CLAUDE_STATE"] ?? storage + "claude.sqlite") + ".signal": "Claude",
            (environment["SESSION_TRACKER_COPILOT_STATE"] ?? storage + "copilot.sqlite") + ".signal": "Copilot"
        ]) { [weak self] providers in
            Task { @MainActor [weak self] in self?.queueRefresh(providers) }
        }
        hookWatcher?.start()
        codexObserver = CodexEventObserver { [weak self] in self?.queueRefresh(["Codex"]) }
        codexObserver?.start()
        processWatcher = AgentProcessWatcher { [weak self] provider in self?.processExited(provider) }
        terminationObserver = NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.notificationTask?.cancel()
                self?.processWatcher?.stop(); self?.exitRefreshTask?.cancel()
                self?.codexObserver?.stop(); self?.hookWatcher?.stop()
                self?.eventRefreshTask?.cancel(); self?.timer?.cancel()
            }
        }
    }

    private func processExited(_ provider: String) {
        exitedProviders.insert(provider)
        queueRefresh([provider])
        exitRefreshTask?.cancel()
        // The shared agent server may take a moment to notice its client vanished.
        // Coalesce closed tabs, then reconcile again without increasing idle polling.
        exitRefreshTask = Task { [weak self] in
            for delay in [1, 3, 6] {
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
                guard let self else { return }
                self.queueRefresh(self.exitedProviders)
            }
            self?.exitedProviders.removeAll()
            self?.exitRefreshTask = nil
        }
    }

    private func updateProcessWatches() async {
        let discovered = await Task.detached { () -> [Int32: String]? in
            let process = Process(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/bin/ps")
            process.arguments = ["-axo", "pid=,tty=,comm="]
            process.standardOutput = output; process.standardError = FileHandle.nullDevice
            do { try process.run() } catch { return nil }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            return AgentProcessWatcher.terminalProcesses(String(decoding: data, as: UTF8.self))
        }.value
        guard var processes = discovered else { return }
        for row in sessions where !row.simulated && [.idle, .working, .needsInput].contains(row.state) {
            if let pid = row.agentPID, pid > 1 { processes[pid] = row.provider }
        }
        processWatcher?.update(processes)
    }

    private func queueRefresh(_ providers: Set<String>) {
        pendingProviders.formUnion(providers)
        guard eventRefreshTask == nil else { return }
        eventRefreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            while let self, !Task.isCancelled, !self.pendingProviders.isEmpty {
                if self.refreshing || self.cleaning {
                    try? await Task.sleep(for: .milliseconds(250))
                    continue
                }
                let providers = self.pendingProviders
                self.pendingProviders.removeAll()
                await self.refresh(providers: providers)
                // Bound work during bursts without postponing indefinitely as events arrive.
                try? await Task.sleep(for: .seconds(1))
            }
            self?.eventRefreshTask = nil
        }
    }

    private var matchingSessions: [Session] {
        sessions.filter {
            (!$0.simulated || showDemo) && matchesSearch($0)
            && ((isSearching && searchScope == .everywhere) || ((provider == "All tools" || $0.provider == provider)
            && (projectFilter == "All projects" || $0.cwd == projectFilter)))
        }
    }
    var visible: [Session] {
        return matchingSessions.filter { searchScope.includes($0, searching: isSearching, filter: filter, provider: provider, project: projectFilter, pinned: pinned) }.sorted {
            if $0.state.rank != $1.state.rank { return $0.state.rank < $1.state.rank }
            if $0.state == .needsInput, $1.state == .needsInput {
                let left = $0.attention?.since ?? $0.updated, right = $1.attention?.since ?? $1.updated
                if left != right { return left < right }
            }
            if pinned.contains($0.id) != pinned.contains($1.id) { return pinned.contains($0.id) }
            return $0.updated == $1.updated ? $0.id < $1.id : $0.updated > $1.updated
        }
    }
    func count(for filter: String) -> Int {
        matchingSessions.filter { SessionPresentation.includes($0, filter: filter, pinned: pinned) }.count
    }
    var projectPaths: [String] { Set(sessions.filter { !$0.simulated && !$0.cwd.isEmpty }.map(\.cwd)).sorted() }
    func togglePin(_ row: Session) {
        var next = pinned
        if !next.insert(row.id).inserted { next.remove(row.id) }
        do {
            try store?.save(next, key: "pinnedSessions")
            pinned = next
        } catch { self.error = "Could not save pinned sessions: \(error.localizedDescription)" }
    }
    var connectionNeedsAttention: Bool {
        copilotConnectionError != nil || claudeRepairError != nil || !providerErrors.isEmpty
    }
    var connectionSummary: String {
        connectionNeedsAttention ? "Connections need attention" : connectedProviders.isEmpty ? "Checking connections…" : "Connections ready"
    }
    func activitySummary(for row: Session) -> String {
        if row.state == .needsInput { return row.attention?.detail.map { SessionPresentation.excerpt($0) } ?? row.attention?.title ?? "Input requested in terminal" }
        let latest = contexts[row.id]?.latestResponse ?? ""
        let purpose = briefs[row.id]?.purpose ?? ""
        let source = !purpose.isEmpty ? purpose : !latest.isEmpty ? latest : row.preview
        return SessionPresentation.excerpt(source)
    }
    func terminalActionTitle(for row: Session) -> String {
        if row.state == .saved { return "Resume session…" }
        if TerminalTarget.uniqueMatch(for: row, sessions: sessions, targets: terminalTargets) != nil { return "Go to terminal" }
        return "Locate terminal…"
    }
    var selected: Session? { visible.first { $0.id == selection } }
    var attentionCount: Int { sessions.filter { !$0.simulated && $0.state == .needsInput }.count }
    var projects: Int { Set(visible.map(\.project)).count }

    func refresh(userInitiated: Bool = false, providers: Set<String> = ["Codex", "Claude", "Copilot"]) async {
        guard !cleaning else { return }
        if refreshing {
            if userInitiated {
                manualRefreshing = true
                let missing = providers.subtracting(refreshingProviders)
                if !missing.isEmpty { queueRefresh(missing) }
            }
            return
        }
        refreshing = true
        refreshingProviders = providers
        manualRefreshing = userInitiated
        defer {
            manualRefreshing = false
            refreshing = false
            refreshingProviders.removeAll()
            let waiters = refreshWaiters
            refreshWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
        var fetched = sessions.filter { !$0.simulated && !providers.contains($0.provider) }
        for tool in ["Codex", "Copilot", "Claude"] where providers.contains(tool) {
            do {
                let data = try await Bridge.run(["snapshot"], provider: tool)
                var rows = try JSONDecoder().decode([Session].self, from: data)
                for index in rows.indices {
                    rows[index].attention = AttentionRequest.reconcile(rows[index], previous: sessions.first { $0.id == rows[index].id }, now: Date().timeIntervalSince1970)
                }
                if connectedProviders.contains(tool) {
                    for alert in SessionAlert.transitions(from: sessions, to: rows) {
                        recentAlerts.removeAll { $0.id == alert.id }
                        recentAlerts.insert(alert, at: 0)
                        queueNotification(alert)
                        if alert.kind == .finished {
                            Task { await self.appendHistory(alert.session) }
                        }
                    }
                }
                providerErrors.removeValue(forKey: tool)
                connectedProviders.insert(tool)
                fetched += rows
            } catch {
                // An agent that has never been used is not a broken connection.
                if sessions.contains(where: { $0.provider == tool && !$0.simulated }) || connectedProviders.contains(tool) {
                    providerErrors[tool] = error.localizedDescription
                }
                connectedProviders.remove(tool)
                fetched += Recovery.offline(sessions.filter { $0.provider == tool }, reason: "Live connection unavailable.")
            }
        }
        var local = localCleanupState
        for row in fetched where [.working, .idle, .needsInput].contains(row.state) {
            local.archived.remove(row.id)
            local.removed.remove(row.id)
        }
        do {
            if local != localCleanupState {
                try store?.save(local, key: "localCleanupState"); localCleanupState = local
            }
        }
        catch { self.error = "Could not save local archive state: \(error.localizedDescription)" }
        fetched.removeAll { local.removed.contains($0.id) }
        for index in fetched.indices where local.archived.contains(fetched[index].id) {
            fetched[index].state = .archived
            fetched[index].reason = "Archived in RunHuddle; agent history is preserved."
        }
        fetched.sort { $0.id < $1.id }
        recentAlerts = Array(recentAlerts.prefix(8))
        let nextSessions = fetched + sessions.filter(\.simulated)
        let sessionsChanged = sessions != nextSessions
        if sessionsChanged { sessions = nextSessions }
        terminalChoices = terminalChoices.filter { id, _ in sessions.contains { $0.id == id && [.working, .idle, .needsInput].contains($0.state) } }
        connection = ["Codex", "Copilot", "Claude"].map { tool in
            if let error = providerErrors[tool] { return "\(tool) unavailable: \(error)" }
            if connectedProviders.contains(tool) { return "\(tool) connected · \(fetched.filter { $0.provider == tool }.count) sessions" }
            return "\(tool) not connected"
        }.joined(separator: " · ")
        checkInputReminders()
        await updateProcessWatches()
        await ensureCopilotTracking()
        await repairClaudeTracking()
        lastRefresh = Date()
        do { if sessionsChanged { try store?.save(fetched, key: "sessions") } }
        catch { self.error = "Could not save the session index: \(error.localizedDescription)" }
    }

    func dismissCopilotNotice() {
        copilotConnectionNotice = nil
        UserDefaults.standard.set(false, forKey: "copilotNoticePending")
    }

    func repairClaudeTracking(retry: Bool = false) async {
        guard retry || !attemptedClaudeRepair else { return }
        guard Bundle.main.bundleURL.pathExtension == "app", !Bundle.main.bundlePath.hasPrefix("/Volumes/") else { return }
        attemptedClaudeRepair = true
        claudeRepairError = nil
        do {
            let data = try await Bridge.run(["repair-hooks"], provider: "Claude")
            if try JSONDecoder().decode(ClaudeRepairResult.self, from: data).repaired {
                UserDefaults.standard.set(true, forKey: "claudeRepairNoticePending")
                claudeRepairNotice = "Claude tracking paths were updated. Fully exit already-open Claude processes, then launch Claude again from your shell to reload hooks. Using /resume inside an existing process may retain old paths."
            }
        } catch { claudeRepairError = "Claude tracking paths could not be repaired: \(error.localizedDescription)" }
    }

    func ensureCopilotTracking(retry: Bool = false) async {
        guard !connectingCopilot, retry || !attemptedCopilotConnection else { return }
        let paths = [NSHomeDirectory() + "/.local/bin/copilot", "/opt/homebrew/bin/copilot", "/usr/local/bin/copilot", NSHomeDirectory() + "/.npm-global/bin/copilot"]
            + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map { String($0) + "/copilot" }
        guard sessions.contains(where: { $0.provider == "Copilot" && !$0.simulated }) || paths.contains(where: { FileManager.default.isExecutableFile(atPath: $0) }) else { return }
        guard Bundle.main.bundleURL.pathExtension == "app", !Bundle.main.bundlePath.hasPrefix("/Volumes/") else { return }
        attemptedCopilotConnection = true
        connectingCopilot = true
        copilotConnectionError = nil
        defer { connectingCopilot = false }
        do {
            let data = try await Bridge.run(["diagnostics"], provider: "Copilot")
            let status = try JSONDecoder().decode(CopilotTrackingStatus.self, from: data)
            guard !status.configured else { return }
            _ = try await Bridge.run(["install-hooks"], provider: "Copilot")
            copilotConnectionNotice = "Copilot tracking is ready. New sessions connect automatically. Restart/resume existing sessions to track them too."
            UserDefaults.standard.set(true, forKey: "copilotNoticePending")
        } catch {
            copilotConnectionError = "Copilot tracking could not be enabled: \(error.localizedDescription)"
        }
    }

    func purpose(for row: Session) -> String {
        let note = briefs[row.id]?.purpose ?? ""
        return note.isEmpty ? row.preview : note
    }
    func setBrief(_ brief: SessionBrief, for row: Session) {
        briefs[row.id] = brief
        do { try store?.save(briefs, key: "sessionBriefs") }
        catch { self.error = "Could not save session notes: \(error.localizedDescription)" }
    }
    func matchesSearch(_ row: Session) -> Bool {
        query.isEmpty || row.matches(query) || displayName(for: row).localizedCaseInsensitiveContains(query)
            || purpose(for: row).localizedCaseInsensitiveContains(query)
            || (briefs[row.id]?.nextStep.localizedCaseInsensitiveContains(query) ?? false)
            || (historySearchQuery == query && historyMatches[row.id] != nil)
    }
    func scheduleHistorySearch() {
        searchDebounce?.cancel()
        historyMatches = [:]
        historySearchQuery = ""
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            searchScope = .everywhere
            historySearchStatus = ""; searchingHistory = false; return
        }
        searchingHistory = true
        historySearchStatus = "Searching recorded history…"
        searchDebounce = Task { @MainActor in
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            await searchHistory()
        }
    }
    private func searchHistory() async {
        guard !searchInFlight else { return }
        let requested = query
        guard !requested.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        searchInFlight = true
        defer {
            searchInFlight = false
            if query != requested { scheduleHistorySearch() }
            else { searchingHistory = false }
        }
        do {
            let data = try await Bridge.run(["search", requested], provider: "Search")
            struct Result: Decodable { let matches: [HistoryMatch]; let indexedSessions: Int; let warning: String }
            let result = try JSONDecoder().decode(Result.self, from: data)
            guard query == requested else { return }
            historyMatches = Dictionary(result.matches.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            historySearchQuery = requested
            historySearchStatus = "Searched \(result.indexedSessions) local transcripts" + (result.warning.isEmpty ? "" : " · " + result.warning)
        } catch {
            guard query == requested else { return }
            historySearchStatus = "History search unavailable; title and project search still work."
        }
    }
    func displayName(for row: Session) -> String { displayNames[row.id] ?? row.title }
    func beginRename(_ row: Session) {
        renameText = displayName(for: row)
        renameError = nil
        renameSession = row
    }
    @discardableResult func saveDisplayName(_ value: String, for row: Session) -> Bool {
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        var updated = displayNames
        if name.isEmpty || name == row.title { updated.removeValue(forKey: row.id) }
        else { updated[row.id] = name }
        do {
            guard let store else { throw NSError(domain: "RunHuddle", code: 1, userInfo: [NSLocalizedDescriptionKey: "Local storage is unavailable."]) }
            try store.save(updated, key: "displayNames")
            displayNames = updated
            renameError = nil
            return true
        } catch {
            let message = "Could not save session name: \(error.localizedDescription)"
            if renameSession != nil { renameError = message } else { self.error = message }
            return false
        }
    }
    func setDraft(_ text: String, for id: String) {
        drafts[id] = text
        do { try store?.save(drafts.filter { !$0.key.hasPrefix("Claude:demo-") }, key: "drafts") }
        catch { self.error = "Could not save handoff: \(error.localizedDescription)" }
    }
    // Reserve the action immediately so repeated clicks cannot queue duplicates.
    // Finish an in-flight observation before mutating session data; polling stays enabled otherwise.
    private func beginCleanup() async -> Bool {
        guard !cleaning else { return false }
        cleaning = true
        if refreshing {
            cleanupProgress = "Waiting for the current status check…"
            await withCheckedContinuation { refreshWaiters.append($0) }
        }
        cleanupProgress = "Preparing cleanup review…"
        return true
    }

    func prepareCleanup(_ operation: String, row: Session) async {
        guard !row.simulated, row.provider == "Codex" else { return }
        guard await beginCleanup() else { return }
        defer { cleaning = false }
        do {
            let data = try await Bridge.run(["plan", row.sessionID, "--operation", operation])
            cleanupPlan = try JSONDecoder().decode(CleanupPlan.self, from: data)
        } catch { self.error = "Cannot prepare cleanup: \(error.localizedDescription)" }
    }
    func applyCleanup(_ plan: CleanupPlan) async {
        guard await beginCleanup() else { return }
        do {
            let ids = plan.affected.map(\.id)
            let encoded = String(data: try JSONEncoder().encode(ids), encoding: .utf8)!
            _ = try await Bridge.run(["apply", plan.threadID, "--operation", plan.action, "--expected-ids", encoded])
            let affected = Set(ids.map { "Codex:" + $0 })
            sessions.removeAll { affected.contains($0.id) }
            recentAlerts.removeAll { affected.contains($0.session.id) }
            if let selection, affected.contains(selection) { self.selection = nil }
            cleanupPlan = nil
            cleanupMessage = "\(plan.title) request completed."
            if plan.action == "delete" {
                for id in ids { _ = try await Bridge.run(["forget", "Codex", id], provider: "LocalCleanup") }
                for id in affected {
                    historyTasks[id]?.cancel()
                    historyTasks.removeValue(forKey: id)
                    briefs.removeValue(forKey: id)
                    displayNames.removeValue(forKey: id)
                    drafts.removeValue(forKey: id)
                    handoffs.removeValue(forKey: id); handoffBackups.removeValue(forKey: id)
                    handoffCandidates.removeValue(forKey: id); handoffErrors.removeValue(forKey: id)
                    contexts.removeValue(forKey: id)
                    historyErrors.removeValue(forKey: id)
                }
                try store?.save(contexts, key: "handoffContexts")
                try store?.save(handoffs, key: "generatedHandoffs")
                try store?.save(handoffBackups, key: "handoffBackups")
                try store?.save(displayNames, key: "displayNames")
                try store?.save(briefs, key: "sessionBriefs")
            }
            do {
                try store?.save(drafts.filter { !$0.key.hasPrefix("Claude:demo-") }, key: "drafts")
                try store?.save(sessions.filter { !$0.simulated }, key: "sessions")
            } catch { self.error = "Codex cleanup succeeded, but local storage could not be updated: \(error.localizedDescription)" }
        } catch {
            cleanupPlan = nil
            self.error = "Cleanup could not be confirmed: \(error.localizedDescription). Refresh before retrying."
        }
        cleaning = false
        await refresh()
    }
    func prepareBulkCleanup(_ operation: String, rows requested: [Session]) async {
        guard await beginCleanup() else { return }
        defer { cleaning = false }
        var entries: [BulkCleanupReview.Entry] = []
        var skipped: [String] = []
        for (index, old) in requested.enumerated() {
            cleanupProgress = "Reviewing session \(index + 1) of \(requested.count)…"
            let name = displayName(for: old)
            guard let row = sessions.first(where: { $0.id == old.id }), !row.simulated else {
                skipped.append("\(name): unavailable or simulated"); continue
            }
            let eligible = operation == "archive" ? row.state == .saved : row.state == .archived
            guard eligible else {
                skipped.append("\(name): \(operation == "delete" ? "archive first; running or unknown sessions cannot be removed" : "running, unknown, or not eligible for this action")")
                continue
            }
            do {
                var native: CleanupPlan?
                var local: LocalHistoryPlan?
                if row.provider == "Codex" {
                    let data = try await Bridge.run(["plan", row.sessionID, "--operation", operation])
                    native = try JSONDecoder().decode(CleanupPlan.self, from: data)
                } else if operation == "delete" {
                    let data = try await Bridge.run(["plan", row.provider, row.sessionID], provider: "LocalCleanup")
                    local = try JSONDecoder().decode(LocalHistoryPlan.self, from: data)
                }
                entries.append(.init(session: row, name: name, native: native, local: local))
            } catch { skipped.append("\(name): \(error.localizedDescription.split(separator: "\n").last.map(String.init) ?? "Could not verify session")") }
        }
        var covered: Set<String> = []
        entries = entries.sorted { $0.count > $1.count }.filter { entry in
            let ids = Set(entry.native?.affected.map { "Codex:" + $0.id } ?? [entry.id])
            guard covered.isDisjoint(with: ids) else {
                skipped.append("\(entry.name): included through another selected Codex conversation"); return false
            }
            covered.formUnion(ids)
            return true
        }
        bulkReview = BulkCleanupReview(operation: operation, entries: entries, skipped: skipped)
    }

    func applyBulkCleanup(_ review: BulkCleanupReview) async {
        guard await beginCleanup() else { return }
        var completed = 0
        var failures: [String] = []
        for (index, entry) in review.entries.enumerated() {
            cleanupProgress = "Processing session \(index + 1) of \(review.entries.count)…"
            do {
                let row = entry.session
                var affected = Set([row.id])
                if let native = entry.native {
                    let ids = native.affected.map(\.id)
                    let encoded = String(data: try JSONEncoder().encode(ids), encoding: .utf8)!
                    _ = try await Bridge.run(["apply", native.threadID, "--operation", review.operation, "--expected-ids", encoded])
                    affected = Set(ids.map { "Codex:" + $0 })
                    if review.operation == "delete" {
                        for id in ids { _ = try await Bridge.run(["forget", "Codex", id], provider: "LocalCleanup") }
                    }
                } else {
                    var local = localCleanupState
                    guard let store else { throw NSError(domain: "Cleanup", code: 1, userInfo: [NSLocalizedDescriptionKey: "Local storage is unavailable"]) }
                    if review.operation == "restore" {
                        local.archived.remove(row.id)
                    } else if review.operation == "archive" {
                        let data = try await Bridge.run(["snapshot"], provider: row.provider)
                        let current = try JSONDecoder().decode([Session].self, from: data)
                        guard current.contains(where: { $0.id == row.id && $0.state == .saved }) else {
                            throw NSError(domain: "Cleanup", code: 1, userInfo: [NSLocalizedDescriptionKey: "Session is no longer confirmed closed"])
                        }
                        local.archived.insert(row.id)
                    } else if let plan = entry.local {
                        let data = try await Bridge.run(["validate", row.provider, row.sessionID, "--expected", plan.fingerprint], provider: "LocalCleanup")
                        let checked = try JSONDecoder().decode(LocalHistoryPlan.self, from: data)
                        guard checked.paths == plan.paths else { throw NSError(domain: "Cleanup", code: 1, userInfo: [NSLocalizedDescriptionKey: "History paths changed; review again"]) }
                        let paths = plan.paths
                        try await Task.detached {
                            for path in paths {
                                let url = URL(fileURLWithPath: path)
                                guard try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else {
                                    throw NSError(domain: "Cleanup", code: 1, userInfo: [NSLocalizedDescriptionKey: "History target became a symlink"])
                                }
                                try FileManager.default.trashItem(at: url, resultingItemURL: nil)
                            }
                        }.value
                        local.archived.remove(row.id)
                        local.removed.insert(row.id)
                        // Save the tombstone before optional cache cleanup; it prevents old agent indexes resurrecting the row.
                        try store.save(local, key: "localCleanupState")
                        localCleanupState = local
                        _ = try await Bridge.run(["forget", row.provider, row.sessionID], provider: "LocalCleanup")
                    }
                    try store.save(local, key: "localCleanupState")
                    localCleanupState = local
                }
                if review.operation == "delete" { try removeLocalNotes(affected) }
                bulkSelection.subtract(affected)
                recentAlerts.removeAll { affected.contains($0.session.id) }
                if review.operation == "delete", let selection, affected.contains(selection) { self.selection = nil }
                completed += entry.count
            } catch {
                failures.append("\(entry.name): \(error.localizedDescription.split(separator: "\n").last.map(String.init) ?? "Cleanup failed"). Some changes may already have completed. Refresh before retrying.")
            }
        }
        bulkReview = nil
        cleaning = false
        cleanupMessage = "Cleanup completed for \(completed) sessions; \(review.skipped.count) selections skipped; \(failures.count) failed."
        await refresh()
        if !failures.isEmpty { error = failures.joined(separator: "\n\n") }
    }

    private func removeLocalNotes(_ ids: Set<String>) throws {
        for id in ids {
            historyTasks[id]?.cancel()
            historyTasks.removeValue(forKey: id)
            briefs.removeValue(forKey: id)
            displayNames.removeValue(forKey: id)
            drafts.removeValue(forKey: id)
            handoffs.removeValue(forKey: id); handoffBackups.removeValue(forKey: id)
            handoffCandidates.removeValue(forKey: id); handoffErrors.removeValue(forKey: id)
            contexts.removeValue(forKey: id)
            historyErrors.removeValue(forKey: id)
            historyMatches.removeValue(forKey: id)
        }
        try store?.save(contexts, key: "handoffContexts")
        try store?.save(handoffs, key: "generatedHandoffs")
        try store?.save(handoffBackups, key: "handoffBackups")
        try store?.save(displayNames, key: "displayNames")
        try store?.save(briefs, key: "sessionBriefs")
        try store?.save(drafts, key: "drafts")
    }

    func draft(for row: Session) -> String { GeneratedHandoff.visibleText(draft: drafts[row.id], generated: handoffs[row.id]) }
    var handoffProviders: [String] {
        ["Codex", "Claude", "Copilot"].filter { provider in
            executable(for: Session(provider: provider, sessionID: "", title: "", cwd: "", state: .saved)) != nil
        }
    }
    func handoffFingerprint(_ row: Session) -> String {
        GeneratedHandoff.fingerprint(context: contexts[row.id]?.text ?? "", purpose: briefs[row.id]?.purpose ?? "", nextStep: briefs[row.id]?.nextStep ?? "")
    }
    func handoffIsStale(_ row: Session) -> Bool {
        handoffs[row.id]?.isStale(sessionUpdated: row.updated, fingerprint: handoffFingerprint(row)) ?? false
    }
    @discardableResult func saveWork(_ record: SavedWork) -> Bool {
        do {
            guard savedWorkLoaded, let store else { throw NSError(domain: "SavedWork", code: 1, userInfo: [NSLocalizedDescriptionKey: "Local storage is unavailable."]) }
            var next = savedWork.filter { $0.id != record.id }
            next.append(record)
            try store.save(next, key: "savedWorkLibrary")
            savedWork = next.sorted { $0.updatedAt > $1.updatedAt }
            workError = nil
            return true
        } catch { workError = "Could not save work: " + error.localizedDescription; return false }
    }
    func deleteWork(_ record: SavedWork) {
        do {
            guard savedWorkLoaded, let store else { throw NSError(domain: "SavedWork", code: 1) }
            let next = savedWork.filter { $0.id != record.id }
            try store.save(next, key: "savedWorkLibrary")
            savedWork = next; workError = nil
        } catch { workError = "Could not delete saved record: " + error.localizedDescription }
    }
    func preserveHandoff(_ row: Session) {
        guard let generated = handoffs[row.id], !draft(for: row).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        var record = SavedWork(session: row, title: displayName(for: row), text: draft(for: row), kind: "Handoff", sourceUpdated: generated.sessionUpdated)
        record.generatedBy = generated.provider; record.generatedAt = generated.generatedAt
        if saveWork(record) { workNotice = "Handoff saved independently in Saved work." }
    }
    func exportWork(_ record: SavedWork) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = "saved-work.md"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try record.markdown.write(to: url, atomically: true, encoding: .utf8) }
        catch { workError = "Could not export: " + error.localizedDescription }
    }
    func generateWorkSummary(_ row: Session) async throws -> SavedWork {
        let provider = handoffAIProvider
        let generator = Session(provider: provider, sessionID: "", title: "", cwd: "", state: .saved)
        guard !row.simulated, let executable = executable(for: generator) else {
            throw NSError(domain: "SavedWork", code: 1, userInfo: [NSLocalizedDescriptionKey: "Choose an installed, signed-in AI CLI."])
        }
        let sourceData = try await Bridge.run(["handoff-context", row.sessionID], provider: row.provider)
        struct Source: Decodable { let text: String }
        let source = try JSONDecoder().decode(Source.self, from: sourceData)
        let payload: [String: String] = ["provider": provider, "executable": executable, "recordKind": "work-summary",
            "sourceProvider": row.provider, "sessionID": row.sessionID, "sessionState": row.state.title,
            "title": displayName(for: row), "project": row.cwd, "purpose": briefs[row.id]?.purpose ?? "",
            "nextStep": briefs[row.id]?.nextStep ?? "", "history": "Original recorded objective: " + row.preview + "\n\n" + source.text]
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("runhuddle-work-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: folder) }
        let input = folder.appendingPathComponent("input.json")
        try JSONEncoder().encode(payload).write(to: input)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: input.path)
        let data = try await Bridge.run([input.path], provider: "HandoffAI")
        struct Response: Decodable { let text: String; let provider: String }
        let response = try JSONDecoder().decode(Response.self, from: data)
        var record = SavedWork(session: row, title: displayName(for: row), text: response.text)
        record.generatedBy = response.provider; record.generatedAt = Date()
        return record
    }
    func generateHandoff(_ row: Session) async {
        guard !row.simulated, !handoffGenerating.contains(row.id) else { return }
        let provider = handoffAIProvider
        let generator = Session(provider: provider, sessionID: "", title: "", cwd: "", state: .saved)
        guard let executable = executable(for: generator) else {
            handoffErrors[row.id] = "Install and sign into the selected AI CLI, or choose another provider."; return
        }
        handoffGenerating.insert(row.id); handoffErrors.removeValue(forKey: row.id)
        handoffProgress[row.id] = "Reading recorded history…"
        defer { handoffGenerating.remove(row.id); handoffProgress.removeValue(forKey: row.id) }
        do {
            await appendHistory(row)
            if let failure = historyErrors[row.id] { throw NSError(domain: "Handoff", code: 1, userInfo: [NSLocalizedDescriptionKey: failure]) }
            let sourceData = try await Bridge.run(["handoff-context", row.sessionID], provider: row.provider)
            struct Source: Decodable { let text: String }
            let source = try JSONDecoder().decode(Source.self, from: sourceData)
            let fingerprint = handoffFingerprint(row)
            let existing = draft(for: row)
            let payload: [String: String] = ["provider": provider, "executable": executable,
                "sourceProvider": row.provider, "sessionID": row.sessionID, "sessionState": row.state.title,
                "title": displayName(for: row), "project": row.cwd,
                "purpose": briefs[row.id]?.purpose ?? "", "nextStep": briefs[row.id]?.nextStep ?? "",
                "existingHandoff": existing, "history": "Original recorded objective: " + row.preview + "\n\n" + source.text]
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("runhuddle-handoff-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            defer { try? FileManager.default.removeItem(at: folder) }
            let input = folder.appendingPathComponent("input.json")
            try JSONEncoder().encode(payload).write(to: input)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: input.path)
            handoffProgress[row.id] = "Generating with \(provider)…"
            let result = try await Bridge.run([input.path], provider: "HandoffAI")
            struct Response: Decodable { let text: String; let provider: String }
            let response = try JSONDecoder().decode(Response.self, from: result)
            guard sessions.contains(where: { $0.id == row.id }) else { return }
            let generated = GeneratedHandoff(text: response.text, provider: response.provider, sessionUpdated: row.updated, sourceFingerprint: fingerprint)
            handoffCandidates[row.id] = generated
            // Updates to edited drafts are proposed for review; typing during generation is preserved.
            if draft(for: row).isEmpty || (draft(for: row) == existing && handoffs[row.id]?.text == existing) {
                acceptHandoff(row)
            }
        } catch { handoffErrors[row.id] = "Could not generate handoff: " + error.localizedDescription }
    }
    func acceptHandoff(_ row: Session) {
        guard let candidate = handoffCandidates[row.id] else { return }
        // Preserve legacy saved text as a backup, never as the current handoff or AI input.
        let previous = drafts[row.id] ?? draft(for: row)
        var updated = handoffs; updated[row.id] = candidate
        var backups = handoffBackups
        if !previous.isEmpty { backups[row.id] = previous }
        do {
            guard let store else { throw NSError(domain: "Handoff", code: 1, userInfo: [NSLocalizedDescriptionKey: "Local storage is unavailable"]) }
            var updatedDrafts = drafts; updatedDrafts[row.id] = candidate.text
            try store.transaction {
                try store.save(updated, key: "generatedHandoffs")
                try store.save(backups, key: "handoffBackups")
                try store.save(updatedDrafts, key: "drafts")
            }
            handoffs = updated; handoffBackups = backups; drafts = updatedDrafts
            handoffCandidates.removeValue(forKey: row.id)
        } catch { handoffErrors[row.id] = "Could not save generated handoff: " + error.localizedDescription }
    }
    func restoreHandoff(_ row: Session) {
        guard let previous = handoffBackups[row.id] else { return }
        handoffBackups[row.id] = draft(for: row)
        setDraft(previous, for: row.id)
        do { try store?.save(handoffBackups, key: "handoffBackups") }
        catch { handoffErrors[row.id] = error.localizedDescription }
    }
    func seedDemo() {
        guard !sessions.contains(where: \.simulated) else { return }
        let root = NSHomeDirectory()
        for (index, event) in [ClaudeEvent.permission, .prompt, .stop].enumerated() {
            sessions.append(Session(provider: "Claude", sessionID: "demo-\(index)",
                                    title: ["Review a proposed command", "Implement project search", "Prepare a handoff"][index],
                                    cwd: root, project: "Demo project", preview: "Simulated Claude session for testing the tracker without paid access.",
                                    state: event.state, reason: event.reason, simulated: true))
        }
    }
    func simulate(_ event: ClaudeEvent, row: Session) {
        guard row.simulated, let index = sessions.firstIndex(where: { $0.id == row.id }) else { return }
        sessions[index].state = event.state; sessions[index].reason = event.reason
        sessions[index].updated = Date().timeIntervalSince1970
    }

    func appendHistory(_ row: Session) async {
        guard !row.simulated else { return }
        if let pending = historyTasks[row.id] {
            await pending.value
            return
        }
        let task = Task { @MainActor in
            historyLoading.insert(row.id)
            defer { historyLoading.remove(row.id) }
            do {
                let data = try await Bridge.run(["history", row.sessionID], provider: row.provider)
                guard !Task.isCancelled else { return }
                struct Result: Decodable { let text: String; let latestRequest: String?; let latestResponse: String? }
                let history = try JSONDecoder().decode(Result.self, from: data)
                contexts[row.id] = HandoffContext(text: history.text, latestRequest: history.latestRequest, latestResponse: history.latestResponse, sessionUpdated: row.updated)
                historyErrors.removeValue(forKey: row.id)
                do { try store?.save(contexts, key: "handoffContexts") }
                catch { self.error = "Could not save recorded context: \(error.localizedDescription)" }
            } catch {
                guard !Task.isCancelled else { return }
                historyErrors[row.id] = error.localizedDescription
            }
        }
        historyTasks[row.id] = task
        await task.value
        historyTasks.removeValue(forKey: row.id)
    }
    func completeHandoff(_ row: Session) -> String {
        var notes = "# Handoff: " + displayName(for: row) + "\n\nSource: \(row.provider) / \(row.sessionID)\nProject: \(row.cwd)\n"
        if let generated = handoffs[row.id] {
            notes += "AI draft generated: " + generated.generatedAt.ISO8601Format() + " with " + generated.provider + "\n"
        }
        notes += "\n" + draft(for: row)
        if let brief = briefs[row.id], !brief.purpose.isEmpty || !brief.nextStep.isEmpty {
            notes += "\n\n## User-maintained session notes\n"
            if !brief.purpose.isEmpty { notes += "\nPurpose: " + brief.purpose + "\n" }
            if !brief.nextStep.isEmpty { notes += "\nNext step / blocker: " + brief.nextStep + "\n" }
        }
        if handoffIsStale(row) { notes += "\n\nNote: New activity or notes were recorded after this handoff was generated. Review the current project state before continuing." }
        return notes
    }
    func copyHandoff(_ row: Session) async {
        copy(completeHandoff(row))
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    }
    func executable(for row: Session) -> String? {
        let candidates = row.provider == "Codex" ? ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
            : row.provider == "Copilot" ? ["/opt/homebrew/bin/copilot", "/usr/local/bin/copilot", NSHomeDirectory() + "/.local/bin/copilot"]
            : [NSHomeDirectory() + "/.local/bin/claude", "/opt/homebrew/bin/claude"]
        let name = row.provider.lowercased()
        let additional = [NSHomeDirectory() + "/.local/bin", NSHomeDirectory() + "/.npm-global/bin", "/usr/local/bin"]
            + (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        return (candidates + additional.map { $0 + "/" + name }).first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    func resume(_ row: Session, fromMenu: Bool = false) {
        guard !row.simulated, row.state != .archived, !navigatingTerminal else { return }
        navigatingTerminal = true
        terminalNavigationSessionID = row.id
        terminalProgress = "Finding terminal…"
        Task { @MainActor in
            defer { navigatingTerminal = false; terminalNavigationSessionID = nil; terminalProgress = "" }
            await navigate(row, fromMenu: fromMenu)
        }
    }
    private func navigate(_ row: Session, fromMenu: Bool) async {
        await discoverTerminals()
        let remembered = terminalChoices[row.id].flatMap { previous in terminalTargets.first { $0.stillMatchesChoice(previous) } }
        let automatic = TerminalTarget.uniqueMatch(for: row, sessions: sessions, targets: terminalTargets)
        let preferred = automatic?.matchRank(for: row) == 0 ? automatic : remembered ?? automatic
        if let match = preferred {
            do { terminalProgress = "Opening terminal…"; try await TerminalNavigator.focus(match); onTerminalOpened?(); return }
            catch { terminalMessage = error.localizedDescription }
        }
        if fromMenu {
            selection = row.id; query = ""; filter = "All sessions"; provider = "All tools"; projectFilter = "All projects"
            openMainWindow?()
            NSApp.activate(ignoringOtherApps: true)
        }
        terminalSession = row
    }
    func refreshTerminals() {
        guard !navigatingTerminal else { return }
        navigatingTerminal = true
        terminalProgress = "Finding terminals…"
        Task { @MainActor in
            defer { navigatingTerminal = false; terminalProgress = "" }
            await discoverTerminals()
        }
    }
    private func discoverTerminals() async {
        let result = await TerminalNavigator.discover()
        terminalTargets = result.targets
        terminalMessage = result.errors.isEmpty
            ? "Choose an existing tab or pane to bring it forward without sending a prompt."
            : result.errors.joined(separator: "\n")
    }
    func focusTerminal(_ target: TerminalTarget) {
        guard !navigatingTerminal else { return }
        navigatingTerminal = true
        terminalProgress = "Opening terminal…"
        Task { @MainActor in
            defer { navigatingTerminal = false; terminalProgress = "" }
            do {
                try await TerminalNavigator.focus(target)
                if let row = terminalSession, [.working, .idle, .needsInput].contains(row.state) { terminalChoices[row.id] = target }
                terminalSession = nil; onTerminalOpened?()
            }
            catch {
                let message = error.localizedDescription
                await discoverTerminals()
                terminalMessage = message
            }
        }
    }
    func openAnotherTerminal(_ row: Session) {
        guard !row.simulated, let executable = executable(for: row), let command = ShellCommand.resume(row, executable: executable) else {
            error = "The agent executable could not be found."; return
        }
        terminalSession = nil
        launch(command, cwd: row.cwd)
    }
    func showSession(_ id: String) {
        guard id != "notification-test" else { openMainWindow?(); return }
        selection = id; query = ""; filter = "All sessions"; provider = "All tools"; projectFilter = "All projects"
        openMainWindow?()
    }
    func fresh(_ row: Session) async {
        guard !row.simulated, let executable = executable(for: row) else { return }
        await appendHistory(row)
        let prompt = "Continue from this handoff. First inspect the current project state.\n\n" + completeHandoff(row)
        launch("cd -- \(ShellCommand.quote(row.cwd)) && \(ShellCommand.quote(executable)) \(row.provider == "Copilot" ? "-i " : "")\(ShellCommand.quote(prompt))", cwd: row.cwd)
    }
    private func launch(_ command: String, cwd: String) {
        var directory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: cwd, isDirectory: &directory), directory.boolValue else {
            error = "The saved project folder no longer exists: \(cwd)"; return
        }
        guard !navigatingTerminal else { return }
        navigatingTerminal = true
        terminalProgress = "Opening Terminal…"
        Task { @MainActor in
            defer { navigatingTerminal = false; terminalProgress = "" }
            do {
                _ = try await TerminalNavigator.run("""
                    var app = Application("com.apple.Terminal");
                    app.doScript(\(TerminalNavigator.literal(command)));
                    app.activate();
                    """)
            } catch { self.error = "Could not confirm that Terminal opened: \(error.localizedDescription). Check Terminal before trying again." }
        }
    }
    func export(_ row: Session) async {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "handoff.md"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try completeHandoff(row).write(to: url, atomically: true, encoding: .utf8) }
        catch { self.error = error.localizedDescription }
    }
    func enableNotifications() async {
        await refreshNotificationStatus()
        if notificationBlocked {
            openNotificationSettings()
            return
        }
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            await refreshNotificationStatus()
        } catch {
            notifications = false
            notificationBlocked = true
            notificationMessage = "macOS hasn't allowed alerts for this app. You can review this in System Settings; the menu-bar count still works."
        }
    }
    func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notifications = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        notificationBlocked = settings.authorizationStatus == .denied
        notificationMessage = notificationBlocked
            ? "Popups are blocked by macOS. Needs-input and completion events still appear under Recent activity." : nil
        if notifications && settings.alertSetting == .disabled {
            notificationMessage = "Notification banners are disabled in macOS. Enable Banners or Alerts in Notification Settings."
        }
    }
    func openNotificationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }
    func testNotification() async {
        await refreshNotificationStatus()
        guard notifications else { await enableNotifications(); return }
        let row = Session(provider: "Tracker", sessionID: "notification-test", title: "Desktop alerts are working", cwd: "", state: .idle)
        notify(row, title: "RunHuddle · test alert")
    }
    func muteProject(_ row: Session) {
        if !notificationPreferences.mutedProjects.insert(row.cwd).inserted { notificationPreferences.mutedProjects.remove(row.cwd) }
    }
    private func queueNotification(_ alert: SessionAlert) {
        guard notifications, notificationPreferences.allows(alert.session, kind: alert.kind) else { return }
        pendingAlerts[alert.session.id] = alert
        guard notificationTask == nil else { return }
        notificationTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            while let self, self.refreshing {
                do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            }
            self?.flushNotifications()
            self?.notificationTask = nil
        }
    }
    private func checkInputReminders() {
        reminded = reminded.filter { id, since in sessions.contains { $0.id == id && $0.state == .needsInput && $0.attention?.since == since } }
        guard notifications, notificationPreferences.reminderMinutes > 0 else { return }
        for row in sessions where row.state == .needsInput {
            guard let since = row.attention?.since, reminded[row.id] != since,
                  Date().timeIntervalSince1970 - since >= Double(notificationPreferences.reminderMinutes * 60),
                  notificationPreferences.allows(row, kind: .input) else { continue }
            queueNotification(SessionAlert(session: row, kind: .input))
        }
    }
    private func flushNotifications() {
        let alerts = NotificationBatch.current(Array(pendingAlerts.values), sessions: sessions, preferences: notificationPreferences)
        pendingAlerts.removeAll()
        guard notifications, !alerts.isEmpty else { return }
        // Record reminders only when submitting a still-current notification.
        for alert in alerts where alert.kind == .input && notificationPreferences.reminderMinutes > 0 {
            if let since = alert.session.attention?.since,
               Date().timeIntervalSince1970 - since >= Double(max(1, notificationPreferences.reminderMinutes) * 60) {
                reminded[alert.session.id] = since
            }
        }
        if alerts.count == 1 { notify(alerts[0].session, title: alerts[0].title); return }
        let content = UNMutableNotificationContent()
        let waiting = alerts.filter { $0.kind == .input }.count
        content.title = "RunHuddle · \(alerts.count) session updates"
        content.body = "\(waiting) need input · \(alerts.count - waiting) ready for review\n" + alerts.prefix(3).map { displayName(for: $0.session) }.joined(separator: ", ")
        if notificationPreferences.sound { content.sound = .default }
        content.threadIdentifier = "runhuddle-activity"
        deliver(UNNotificationRequest(identifier: "activity-batch", content: content, trigger: nil))
    }
    private func notify(_ row: Session, title: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "\(row.project): \(displayName(for: row))"
        if row.state == .needsInput { content.body += "\n" + (row.attention?.title ?? "Input requested") }
        if notificationPreferences.sound { content.sound = .default }
        content.threadIdentifier = row.cwd.isEmpty ? "runhuddle-activity" : row.cwd
        if row.sessionID != "notification-test" { content.categoryIdentifier = "sessionActivity" }
        deliver(UNNotificationRequest(identifier: row.sessionID == "notification-test" ? row.sessionID : row.id, content: content, trigger: nil))
    }
    private func deliver(_ request: UNNotificationRequest) {
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            guard error != nil else { return }
            Task { @MainActor in
                self?.notifications = false
                self?.notificationBlocked = true
                self?.notificationMessage = "macOS could not deliver alerts. Review Notification Settings; session tracking is still active."
            }
        }
    }

}
