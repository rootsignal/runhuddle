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
            let script = provider == "Search" ? "history_search.py" : provider == "Copilot" ? "copilot_bridge.py" : "codex_bridge.py"
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
                throw NSError(domain: provider, code: 1, userInfo: [NSLocalizedDescriptionKey: detail])
            }
            return data
        }.value
    }
}

@MainActor final class AppModel: ObservableObject {
    @Published var showSetup = !UserDefaults.standard.bool(forKey: "agentSetupCompleted")
    @Published var sessions: [Session] = []
    @Published var selection: String? {
        didSet {
            guard let selection, !selection.hasPrefix("Claude:demo-") else { return }
            do { try store?.save(selection, key: "selection") }
            catch { self.error = "Could not save selection: \(error.localizedDescription)" }
        }
    }
    @Published var query = ""
    @Published var briefs: [String: SessionBrief] = [:]
    @Published var historyMatches: [String: HistoryMatch] = [:]
    @Published var historySearchQuery = ""
    @Published var historySearchStatus = ""
    @Published var searchingHistory = false
    private var searchDebounce: Task<Void, Never>?
    private var searchInFlight = false
    @Published var filter = "All sessions"
    @Published var provider = "All tools"
    @Published var showDemo = false
    @Published var refreshing = false
    @Published var connection = "Connecting to Codex…"
    @Published var lastRefresh: Date?
    @Published var error: String?
    @Published var displayNames: [String: String] = [:]
    @Published var renameSession: Session?
    @Published var renameText = ""
    @Published var renameError: String?
    @Published var drafts: [String: String] = [:]
    @Published var historyLoading: Set<String> = []
    @Published var contexts: [String: HandoffContext] = [:]
    @Published var historyErrors: [String: String] = [:]
    private var historyTasks: [String: Task<Void, Never>] = [:]
    @Published var notifications = false
    @Published var notificationBlocked = false
    @Published var notificationMessage: String?
    @Published var recentAlerts: [SessionAlert] = []
    @Published var navigatingTerminal = false
    @Published var terminalProgress = ""
    @Published var terminalSession: Session?
    @Published var terminalTargets: [TerminalTarget] = []
    @Published var terminalMessage = ""
    @Published var cleanupPlan: CleanupPlan?
    @Published var cleaning = false
    @Published var cleanupMessage: String?
    private var store: Store?
    private var timer: Task<Void, Never>?
    private var connectedProviders: Set<String> = []
    private let attentionDelegate = AttentionDelegate()
    var openMainWindow: (() -> Void)?

    init() {
        do {
            let folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("Agent Session Manager", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            store = try Store(path: folder.appendingPathComponent("sessions.sqlite").path)
            sessions = try store?.load([Session].self, key: "sessions") ?? []
            sessions = Recovery.restore(sessions)
            briefs = try store?.load([String: SessionBrief].self, key: "sessionBriefs") ?? [:]
            displayNames = try store?.load([String: String].self, key: "displayNames") ?? [:]
            drafts = try store?.load([String: String].self, key: "drafts") ?? [:]
            contexts = try store?.load([String: HandoffContext].self, key: "handoffContexts") ?? [:]
            selection = try store?.load(String.self, key: "selection")
        } catch { self.error = "Local storage: \(error.localizedDescription)" }
        attentionDelegate.onSelect = { [weak self] id, goToTerminal in
            guard let self else { return }
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
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    var visible: [Session] {
        sessions.filter {
            (!$0.simulated || showDemo) && (matchesSearch($0))
            && ((filter == "All sessions" && $0.state != .archived) || $0.state.title == filter)
            && (provider == "All tools" || $0.provider == provider)
        }.sorted {
            if $0.state.rank != $1.state.rank { return $0.state.rank < $1.state.rank }
            return $0.updated > $1.updated
        }
    }
    var selected: Session? { sessions.first { $0.id == selection } }
    var attentionCount: Int { sessions.filter { !$0.simulated && $0.state == .needsInput }.count }
    var projects: Int { Set(visible.map(\.project)).count }

    func refresh() async {
        guard !refreshing && !cleaning else { return }
        refreshing = true
        defer { refreshing = false }
        var fetched: [Session] = []
        var status: [String] = []
        for tool in ["Codex", "Copilot"] {
            do {
                let data = try await Bridge.run(["snapshot"], provider: tool)
                let rows = try JSONDecoder().decode([Session].self, from: data)
                if connectedProviders.contains(tool) {
                    for alert in SessionAlert.transitions(from: sessions, to: rows) {
                        recentAlerts.removeAll { $0.id == alert.id }
                        recentAlerts.insert(alert, at: 0)
                        if notifications { notify(alert.session, title: alert.title) }
                        if alert.kind == .finished {
                            Task { await self.appendHistory(alert.session) }
                        }
                    }
                }
                connectedProviders.insert(tool)
                fetched += rows
                status.append("\(tool) connected · \(rows.count) sessions")
            } catch {
                connectedProviders.remove(tool)
                fetched += Recovery.offline(sessions.filter { $0.provider == tool }, reason: "Live connection unavailable.")
                status.append("\(tool) unavailable: \(error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines))")
            }
        }
        recentAlerts = Array(recentAlerts.prefix(8))
        sessions = fetched + sessions.filter(\.simulated)
        connection = status.joined(separator: " · ")
        lastRefresh = Date()
        do { try store?.save(fetched, key: "sessions") }
        catch { self.error = "Could not save the session index: \(error.localizedDescription)" }
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
            historySearchStatus = "Searched \(result.indexedSessions) local transcripts · current filters apply" + (result.warning.isEmpty ? "" : " · " + result.warning)
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
    func prepareCleanup(_ operation: String, row: Session) async {
        guard !row.simulated, row.provider == "Codex", !cleaning, !refreshing else { return }
        cleaning = true
        defer { cleaning = false }
        do {
            let data = try await Bridge.run(["plan", row.sessionID, "--operation", operation])
            cleanupPlan = try JSONDecoder().decode(CleanupPlan.self, from: data)
        } catch { self.error = "Cannot prepare cleanup: \(error.localizedDescription)" }
    }
    func applyCleanup(_ plan: CleanupPlan) async {
        guard !cleaning, !refreshing else { return }
        cleaning = true
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
                for id in affected {
                    historyTasks[id]?.cancel()
                    historyTasks.removeValue(forKey: id)
                    briefs.removeValue(forKey: id)
                    displayNames.removeValue(forKey: id)
                    drafts.removeValue(forKey: id)
                    contexts.removeValue(forKey: id)
                    historyErrors.removeValue(forKey: id)
                }
                try store?.save(contexts, key: "handoffContexts")
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
    func draft(for row: Session) -> String { drafts[row.id] ?? row.handoff }
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
        var notes = draft(for: row)
        if let brief = briefs[row.id], !brief.purpose.isEmpty || !brief.nextStep.isEmpty {
            notes += "\n\n## User-maintained session notes\n"
            if !brief.purpose.isEmpty { notes += "\nPurpose: " + brief.purpose + "\n" }
            if !brief.nextStep.isEmpty { notes += "\nNext step / blocker: " + brief.nextStep + "\n" }
        }
        return HandoffContext.compose(notes: notes, context: contexts[row.id], failure: historyErrors[row.id])
    }
    func copyHandoff(_ row: Session) async {
        await appendHistory(row)
        copy(completeHandoff(row))
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    }
    func executable(for row: Session) -> String? {
        let candidates = row.provider == "Codex" ? ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
            : row.provider == "Copilot" ? ["/opt/homebrew/bin/copilot", "/usr/local/bin/copilot", NSHomeDirectory() + "/.local/bin/copilot"]
            : [NSHomeDirectory() + "/.local/bin/claude", "/opt/homebrew/bin/claude"]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    func resume(_ row: Session, fromMenu: Bool = false) {
        guard !row.simulated, row.state != .archived, !navigatingTerminal else { return }
        navigatingTerminal = true
        terminalProgress = "Finding terminal…"
        Task { @MainActor in
            defer { navigatingTerminal = false; terminalProgress = "" }
            await navigate(row, fromMenu: fromMenu)
        }
    }
    private func navigate(_ row: Session, fromMenu: Bool) async {
        await discoverTerminals()
        if let match = TerminalTarget.uniqueMatch(for: row, sessions: sessions, targets: terminalTargets) {
            do { terminalProgress = "Opening terminal…"; try await TerminalNavigator.focus(match); return }
            catch { terminalMessage = error.localizedDescription }
        }
        if fromMenu {
            selection = row.id; query = ""; filter = "All sessions"; provider = "All tools"
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
            ? "Choose an existing tab or pane. If the session isn't open, you can explicitly open another terminal."
            : result.errors.joined(separator: "\n")
    }
    func focusTerminal(_ target: TerminalTarget) {
        guard !navigatingTerminal else { return }
        navigatingTerminal = true
        terminalProgress = "Opening terminal…"
        Task { @MainActor in
            defer { navigatingTerminal = false; terminalProgress = "" }
            do { try await TerminalNavigator.focus(target); terminalSession = nil }
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
        selection = id; query = ""; filter = "All sessions"; provider = "All tools"
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
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        var details: NSDictionary?
        NSAppleScript(source: "tell application \"Terminal\"\nactivate\ndo script \"\(escaped)\"\nend tell")?.executeAndReturnError(&details)
        if let details { error = "Could not open Terminal: \(details)" }
    }
    func export(_ row: Session) async {
        await appendHistory(row)
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
    private func notify(_ row: Session, title: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "\(row.project): \(displayName(for: row))"
        content.sound = .default
        if row.sessionID != "notification-test" { content.categoryIdentifier = "sessionActivity" }
        let request = UNNotificationRequest(identifier: row.sessionID == "notification-test" ? row.sessionID : row.id, content: content, trigger: nil)
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
