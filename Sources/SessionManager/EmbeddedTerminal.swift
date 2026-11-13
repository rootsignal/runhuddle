import AppKit
import SwiftUI
import SwiftTerm
import SessionCore

// Retained independently of SwiftUI windows: hiding or switching views must not
// recreate the PTY or stop the agent.
@MainActor final class EmbeddedAgentSession: NSObject, ObservableObject, Identifiable, LocalProcessTerminalViewDelegate {
    let id: String
    let provider: String
    let directory: String
    var resumedID: String?
    let terminal: LocalProcessTerminalView
    @Published var title: String
    @Published var ended = false
    @Published var stopping = false
    @Published var stopFailure: String?
    @Published private(set) var shellActivity: ShellAgentLink?
    private(set) var stopRequested = false
    @Published var exitCode: Int32?
    private(set) var pid: Int32 = 0
    var onProcessExit: ((EmbeddedAgentSession) -> Void)?
    var appliedCursorPreference: String?
    var appliedPalette: [SwiftTerm.Color]?
    var persistentRecord: PersistentTerminalRecord?
    let persistentService: PersistentTerminalService
    private var monitor: Task<Void, Never>?
    var isShell: Bool { provider == "Shell" }
    var isAgentRunning: Bool { persistentRecord != nil ? !ended : terminal.process.running }
    private var detaching = false

    init(executable: String, directory: String, resume: String? = nil, provider: String = "Codex", prompt: String? = nil, persistent: PersistentTerminalRecord? = nil, service: PersistentTerminalService = .shared) {
        self.persistentService = service
        self.id = persistent?.id ?? UUID().uuidString
        self.persistentRecord = persistent
        self.provider = provider
        self.directory = directory
        self.resumedID = persistent?.sessionID ?? resume
        title = persistent?.title ?? URL(fileURLWithPath: directory).lastPathComponent
        terminal = HuddleTerminalView(frame: NSRect(x: 0, y: 0, width: 900, height: 540))
        super.init()
        let settings = TerminalPreferences.shared.value
        let dark = NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        terminal.getTerminal().ansi256PaletteStrategy = .xterm
        let colors = settings.colors(dark: dark)
        terminal.font = settings.resolvedFont
        terminal.nativeBackgroundColor = colors.0
        terminal.nativeForegroundColor = colors.1
        let palette = settings.ansiColors(dark: dark)
        terminal.installColors(palette)
        appliedPalette = palette
        // SwiftTerm's non-bright path also shifts extended indices down by 8.
        // Keep standard indices intact; users can customize the bright palette.
        terminal.useBrightColors = true
        terminal.processDelegate = self
        if let persistent {
            if let pane = try? persistentService.pane(persistent) { pid = pane.pid; ended = pane.dead; exitCode = pane.exitCode }
            attach()
            monitor = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    guard let self, !self.detaching else { return }
                    self.checkPersistentProcess()
                }
            }
            return
        }
        var arguments = [executable]
        if let resume { arguments += provider == "Codex" ? ["resume", resume] : ["--resume", resume] }
        if let prompt { arguments += provider == "Copilot" ? ["-i", prompt] : [prompt] }
        // Login + interactive shell supplies the user's normal CLI environment. The executable and
        // arguments remain individually quoted; no prompt or approval flags.
        let command = "exec " + arguments.map(ShellCommand.quote).joined(separator: " ")
        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "NO_COLOR")
        env["TERM"] = "xterm-256color"; env["COLORTERM"] = "truecolor"
        env["TERM_PROGRAM"] = "RunHuddle"
        // Keep argv quoting in zsh; the user's shell supplies its normal startup environment.
        let startup = PersistentTerminalService.loginInvocation(shell: persistentService.agentShell,
            command: "exec /bin/zsh -c " + ShellCommand.quote(command))
        terminal.startProcess(executable: startup[0], args: Array(startup.dropFirst()),
                              environment: env.map { "\($0.key)=\($0.value)" }, currentDirectory: directory)
        pid = terminal.process.shellPid
        if !terminal.process.running { ended = true }
    }
    func row(in model: AppModel) -> Session? {
        guard !isShell else { return nil }
        let rows = model.sessions.filter { $0.provider == provider && !$0.simulated }
        if let resumedID = resumedID ?? (ended ? persistentRecord?.sessionID : nil) { return rows.first { $0.sessionID == resumedID } }
        if let exact = rows.first(where: { $0.agentPID == pid && pid > 0 }) { return exact }
        // Codex's thread feed currently has no client PID. Use the title emitted
        // by this PTY only when the full title + project identify one live row.
        // Re-evaluate each time: /new and /resume can switch this terminal's thread.
        guard !ended else { return nil }
        let target = TerminalTarget(app: "RunHuddle", window: id, identity: id, title: title, cwd: directory)
        let claimed = Set(EmbeddedTerminals.shared.sessions.filter { $0.id != id && $0.provider == provider }.compactMap { other in
            (other.resumedID ?? other.persistentRecord?.sessionID).map { provider + ":" + $0 }
        })
        return target.uniqueUnclaimedSession(in: rows, claimedIDs: claimed)
    }
    func attach() {
        guard let record = persistentRecord, !terminal.process.running else { return }
        let service = persistentService
        terminal.startProcess(executable: service.executable, args: service.baseArguments + ["attach-session", "-t", record.name], environment: service.environment.map { "\($0.key)=\($0.value)" }, currentDirectory: directory)
    }
    private func checkPersistentProcess() {
        guard let record = persistentRecord else { return }
        do {
            let pane = try persistentService.pane(record)
            pid = pane.pid
            if isShell {
                let activity = pane.dead ? nil : try? persistentService.shellActivity(record)
                if activity != shellActivity {
                    shellActivity = activity
                    EmbeddedTerminals.shared.objectWillChange.send()
                }
            }
            if pane.dead && !ended {
                exitCode = pane.exitCode
                onProcessExit?(self)
                ended = true; stopping = false
            }
            if !terminal.process.running { attach() }
        } catch {
            if isShell { shellActivity = nil; EmbeddedTerminals.shared.objectWillChange.send() }
            if !ended { onProcessExit?(self) }
            ended = true; stopping = false
        }
    }
    func renameShell(_ name: String) throws {
        guard isShell, var record = persistentRecord else { return }
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw TerminalStartError.message("Enter a terminal name.") }
        record.title = value
        try persistentService.remember(record)
        persistentRecord = record; title = value
        EmbeddedTerminals.shared.objectWillChange.send()
    }
    func detach() {
        detaching = true; monitor?.cancel()
        if persistentRecord != nil { terminal.terminate() }
    }
    func stop() {
        guard isAgentRunning, !stopping else { return }
        stopping = true
        stopRequested = true
        if isShell, let record = persistentRecord {
            do {
                // Closing this PTY also signals its foreground job; never touch other panes.
                try persistentService.run(["kill-session", "-t", record.name])
                ended = true; stopping = false
                EmbeddedTerminals.shared.objectWillChange.send()
            } catch { stopping = false; stopFailure = error.localizedDescription }
            return
        }
        let ownedPID = pid
        guard ownedPID > 1 else { stopping = false; return }
        // Stop only this owned PTY process group, never the shared agent server.
        let group = getpgid(ownedPID) == ownedPID
        kill(group ? -ownedPID : ownedPID, SIGTERM)
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard let self, !self.ended, self.isAgentRunning, self.pid == ownedPID else { return }
            if group && getpgid(ownedPID) == ownedPID { kill(-ownedPID, SIGKILL) }
            else { kill(ownedPID, SIGKILL) }
        }
    }
    nonisolated func sizeChanged(source: LocalProcessTerminalView, newCols: Int, newRows: Int) {}
    nonisolated func setTerminalTitle(source: LocalProcessTerminalView, title: String) {
        DispatchQueue.main.async { [weak self] in if !title.isEmpty, self?.isShell == false { self?.title = title } }
    }
    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func processTerminated(source: TerminalView, exitCode: Int32?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.persistentRecord != nil {
                // An attaching client's exit is not the agent's exit.
                return
            }
            self.exitCode = exitCode
            // Resolve the session while its final title is still available.
            self.onProcessExit?(self)
            self.ended = true
            self.stopping = false
        }
    }
}

@MainActor final class EmbeddedTerminals: ObservableObject {
    static let shared = EmbeddedTerminals()
    static let shellWorkspaceID = "shell-workspace"
    @Published var sessions: [EmbeddedAgentSession] = []
    @Published var presentedID: String? {
        didSet {
            if let id = presentedID, sessions.contains(where: { $0.id == id && $0.isShell }) {
                UserDefaults.standard.set(id, forKey: "lastShellTerminalID")
            }
        }
    }
    func start(model: AppModel, directory: String, resume: Session? = nil, provider: String = "Codex", prompt: String? = nil) throws -> String {
        let provider = resume?.provider ?? provider
        guard ["Codex", "Claude", "Copilot"].contains(provider) else { throw TerminalStartError.message("Choose an installed agent.") }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directory, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw TerminalStartError.message("Choose an existing project folder.")
        }
        if let original = resume {
            let resume = model.sessions.first(where: { $0.id == original.id }) ?? original
            if let existing = sessions.first(where: { $0.row(in: model)?.id == resume.id && !$0.ended }) { return existing.id }
            guard [.saved, .archived].contains(resume.state), !resume.simulated else {
                throw TerminalStartError.message("This session is still open outside RunHuddle. Exit it there before resuming it here.")
            }
            guard UUID(uuidString: resume.sessionID) != nil else { throw TerminalStartError.message("Invalid session ID.") }
        }
        let row = Session(provider: provider, sessionID: "", title: "", cwd: directory, state: .saved)
        guard let executable = model.executable(for: row) else { throw TerminalStartError.message("Install and sign in to \(provider) first.") }
        let record = try PersistentTerminalService.shared.create(executable: executable, directory: directory, provider: provider, resume: resume?.sessionID, prompt: prompt)
        let session = EmbeddedAgentSession(executable: executable, directory: directory, resume: resume?.sessionID, provider: provider, persistent: record)
        session.onProcessExit = { [weak model] terminal in
            guard let model, let row = terminal.row(in: model) else { return }
            model.embeddedProcessExited(row, unexpected: !terminal.stopRequested && terminal.exitCode != 0)
        }
        sessions.append(session)
        return session.id
    }
    func shell(containing row: Session, model: AppModel) -> EmbeddedAgentSession? {
        guard !sessions.contains(where: { !$0.isShell && !$0.ended && $0.row(in: model)?.id == row.id }) else { return nil }
        let matches = sessions.filter { $0.isShell && !$0.ended && $0.shellActivity?.match(model.sessions)?.id == row.id }
        // Two terminals can display the same conversation. Do not guess a route.
        return matches.count == 1 ? matches[0] : nil
    }
    func linkedRow(for shell: EmbeddedAgentSession, model: AppModel) -> Session? {
        guard shell.isShell, !shell.ended, let row = shell.shellActivity?.match(model.sessions),
              self.shell(containing: row, model: model)?.id == shell.id else { return nil }
        return row
    }
    func startShell(directory: String) throws -> String {
        let record = try PersistentTerminalService.shared.create(executable: PersistentTerminalService.loginShell, directory: directory, provider: "Shell", resume: nil, prompt: nil)
        let session = EmbeddedAgentSession(executable: "", directory: directory, provider: "Shell", persistent: record)
        session.onProcessExit = { _ in EmbeddedTerminals.shared.objectWillChange.send() }
        let existing = Set(sessions.filter(\.isShell).map(\.title))
        let base = session.title
        var title = base, number = 2
        while existing.contains(title) { title = base + " (\(number))"; number += 1 }
        if title != base { try session.renameShell(title) }
        sessions.append(session)
        return session.id
    }
    func close(_ session: EmbeddedAgentSession) {
        guard session.ended, !session.isAgentRunning else { return }
        if let record = session.persistentRecord {
            do { try session.persistentService.remove(record) } catch { return }
            session.detach()
        }
        if presentedID == session.id {
            presentedID = session.isShell ? (sessions.first { $0.isShell && $0.id != session.id }?.id ?? Self.shellWorkspaceID) : nil
        }
        sessions.removeAll { $0.id == session.id }
    }
    func closeEndedAgents(sessionIDs: Set<String>) {
        for session in sessions where !session.isShell && session.ended {
            guard let id = session.resumedID ?? session.persistentRecord?.sessionID,
                  sessionIDs.contains(session.provider + ":" + id) else { continue }
            close(session)
        }
    }
    var running: [EmbeddedAgentSession] { sessions.filter { $0.isAgentRunning } }
    var updating = false
    private var restored = false
    func restore(model: AppModel) {
        guard !restored else { return }; restored = true
        do {
            try PersistentTerminalService.shared.prepare()
            for record in try PersistentTerminalService.shared.records() {
                guard (try? PersistentTerminalService.shared.pane(record)) != nil else { continue }
                let session = EmbeddedAgentSession(executable: "", directory: record.directory, provider: record.provider, persistent: record)
                session.onProcessExit = { [weak model] terminal in
                    if terminal.isShell { EmbeddedTerminals.shared.objectWillChange.send(); return }
                    guard let model, let row = terminal.row(in: model) else { return }
                    model.embeddedProcessExited(row, unexpected: !terminal.stopRequested && terminal.exitCode != 0)
                }
                sessions.append(session)
            }
            // One-time migration from the pre-persistence app. Never duplicate a live old process.
            let migrationFile = PersistentTerminalService.shared.folder.appendingPathComponent("resume-after-upgrade.json")
            if FileManager.default.fileExists(atPath: migrationFile.path) {
                let requests = try JSONDecoder().decode([TerminalMigration].self, from: Data(contentsOf: migrationFile))
                var remaining: [TerminalMigration] = []
                for request in requests {
                    guard UUID(uuidString: request.sessionID) != nil, ["Codex", "Claude", "Copilot"].contains(request.provider) else { continue }
                    guard !sessions.contains(where: { $0.provider == request.provider && $0.resumedID == request.sessionID }) else { continue }
                    guard request.previousPID > 1, kill(request.previousPID, 0) != 0, errno == ESRCH else { remaining.append(request); continue }
                    let row = Session(provider: request.provider, sessionID: request.sessionID, title: "", cwd: request.directory, state: .saved)
                    guard let executable = model.executable(for: row) else { remaining.append(request); continue }
                    do {
                        let record = try PersistentTerminalService.shared.create(executable: executable, directory: request.directory, provider: request.provider, resume: request.sessionID, prompt: nil)
                        let terminal = EmbeddedAgentSession(executable: "", directory: request.directory, provider: request.provider, persistent: record)
                        terminal.onProcessExit = { [weak model] terminal in
                            guard let model, let row = terminal.row(in: model) else { return }
                            model.embeddedProcessExited(row, unexpected: !terminal.stopRequested && terminal.exitCode != 0)
                        }
                        sessions.append(terminal)
                    } catch { remaining.append(request); model.error = "Could not resume a session after upgrade: \(error.localizedDescription)" }
                }
                try JSONEncoder().encode(remaining).write(to: migrationFile, options: .atomic)
            }
            if UserDefaults.standard.object(forKey: "reopenTerminalWorkspace") as? Bool != false {
                let last = UserDefaults.standard.string(forKey: "lastTerminalID")
                let selected = sessions.first { session in
                    guard let sessionID = session.resumedID ?? session.persistentRecord?.sessionID else { return false }
                    return session.provider + ":" + sessionID == model.selection
                }
                presentedID = last == Self.shellWorkspaceID ? Self.shellWorkspaceID : (sessions.first(where: { $0.id == last })?.id ?? selected?.id ?? sessions.first?.id)
                model.synchronizePresentedTerminalSelection()
            }
        } catch { model.error = "Could not restore terminals: \(error.localizedDescription)" }
    }
    func rememberMappings(model: AppModel) {
        for session in sessions {
            guard var record = session.persistentRecord, let row = session.row(in: model) else { continue }
            guard record.sessionID != row.sessionID || record.title != session.title else { continue }
            record.sessionID = row.sessionID; record.title = session.title
            do { try PersistentTerminalService.shared.remember(record); session.persistentRecord = record }
            catch { model.error = "Could not save terminal identity: \(error.localizedDescription)" }
        }
    }
    func detachAll() {
        UserDefaults.standard.set(presentedID, forKey: "lastTerminalID")
        sessions.forEach { $0.detach() }
    }
}
enum TerminalStartError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct EmbeddedTerminalHost: NSViewRepresentable {
    let session: EmbeddedAgentSession
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject private var preferences = TerminalPreferences.shared
    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        let terminal = session.terminal
        applyAppearance()
        terminal.removeFromSuperview()
        terminal.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(terminal)
        NSLayoutConstraint.activate([
            terminal.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            terminal.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            terminal.topAnchor.constraint(equalTo: container.topAnchor),
            terminal.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        DispatchQueue.main.async { terminal.window?.makeFirstResponder(terminal) }
        return container
    }
    func updateNSView(_ nsView: NSView, context: Context) { applyAppearance() }
    private func applyAppearance() {
        let dark = colorScheme == .dark
        let terminal = session.terminal
        terminal.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let settings = preferences.value
        terminal.getTerminal().ansi256PaletteStrategy = .xterm
        let colors = settings.colors(dark: dark)
        if terminal.nativeBackgroundColor != colors.0 { terminal.nativeBackgroundColor = colors.0 }
        if terminal.nativeForegroundColor != colors.1 { terminal.nativeForegroundColor = colors.1 }
        let cursor = settings.cursorColors(dark: dark), selection = settings.selectionColors(dark: dark)
        terminal.caretColor = cursor.0
        terminal.caretTextColor = cursor.1
        terminal.selectedTextBackgroundColor = selection.0
        terminal.selectedTextForegroundColor = selection.1
        let palette = settings.ansiColors(dark: dark)
        if session.appliedPalette != palette {
            terminal.installColors(palette)
            session.appliedPalette = palette
        }
        // SwiftTerm's non-bright path also shifts extended indices down by 8.
        // Keep standard indices intact; users can customize the bright palette.
        terminal.useBrightColors = true
        if terminal.font != settings.resolvedFont { terminal.font = settings.resolvedFont }
        terminal.optionAsMetaKey = settings.optionAsMeta
        let engine = terminal.getTerminal()
        let scrollback = min(50000, max(1000, settings.scrollback))
        if engine.options.scrollback != scrollback { engine.changeScrollback(scrollback) }
        if session.appliedCursorPreference != settings.cursor {
            engine.setCursorStyle(CursorStyle(tagName: settings.cursor) ?? .steadyBlock)
            session.appliedCursorPreference = settings.cursor
        }
    }
}

struct EmbeddedTerminalWindow: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var terminals = EmbeddedTerminals.shared
    let id: String
    var body: some View {
        if let session = terminals.sessions.first(where: { $0.id == id }) {
            EmbeddedTerminalContent(session: session)
        } else {
            ContentUnavailableView("Terminal unavailable", systemImage: "terminal", description: Text("Start a Codex session from New session. Persistent terminals reconnect when RunHuddle opens again."))
        }
    }
}
struct EmbeddedTerminalContent: View {
    @EnvironmentObject var model: AppModel
    @ObservedObject var session: EmbeddedAgentSession
    var compact = false
    @ViewState private var confirmStop = false
    @ViewState private var showEndedOutput = false
    var body: some View {
        VStack(spacing: 0) {
            if !compact {
                HStack {
                    Label(session.row(in: model).map { model.displayName(for: $0) } ?? session.title, systemImage: "terminal").font(.headline).lineLimit(1)
                    Spacer()
                    TerminalSessionControls(session: session)
                }.padding(12)
                Divider()
            }
            if session.ended && !showEndedOutput {
                VStack(spacing: 16) {
                    Label("Session ended", systemImage: "checkmark.circle").font(.title2.bold())
                    Text(session.row(in: model) == nil ? "The agent is no longer running. No recorded conversation has been matched to this terminal." : "The agent is no longer running. Its recorded conversation is still available.")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    if let code = session.exitCode, code != 0, !session.stopRequested {
                        Text("The process exited with code \(code).").font(.caption).foregroundStyle(.orange)
                    }
                    HStack {
                        if let row = session.row(in: model) {
                            Button("View conversation") { EmbeddedTerminals.shared.close(session); model.showSession(row.id) }
                            Button("Resume this session") { model.resume(row) }.buttonStyle(.borderedProminent)
                        }
                        Button("Show terminal output") { showEndedOutput = true }
                    }
                }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                if session.ended {
                    HStack { Text("Session ended · terminal output is read-only"); Spacer(); Button("Back") { showEndedOutput = false } }
                        .font(.caption).padding(8)
                }
                EmbeddedTerminalHost(session: session).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            if !compact {
                Text(session.directory).font(.caption).foregroundStyle(.secondary).lineLimit(1).padding(8)
            }

        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).background(HuddleStyle.panel)
            .alert("End this session?", isPresented: $confirmStop) {
                Button("Cancel", role: .cancel) {}
                Button("End session", role: .destructive) { session.stop() }
            } message: { Text("This stops the embedded process and may interrupt work. The agent’s recorded history remains available to resume.") }
    }
}

@MainActor final class EmbeddedTerminalAppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillTerminate(_ notification: Notification) { ProjectCommandRunner.stopAll() }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let running = EmbeddedTerminals.shared.running
        if EmbeddedTerminals.shared.updating || running.isEmpty {
            EmbeddedTerminals.shared.detachAll()
            return .terminateNow
        }
        let alert = NSAlert()
        alert.messageText = "Keep \(running.count) terminal(s) running?"
        alert.informativeText = "Keep running to reconnect to the same agents, shells, and terminal history when RunHuddle reopens. Ending terminals stops their work; saved agent conversations can still be resumed."
        if !ProjectCommandRunner.active.isEmpty { alert.informativeText += " Configured project commands stop when RunHuddle closes." }
        alert.addButton(withTitle: running.contains(where: \.isShell) ? "Close RunHuddle, keep terminals running" : "Close RunHuddle, keep agents running")
        alert.addButton(withTitle: "Cancel")
        alert.addButton(withTitle: "End terminals and quit")
        let choice = alert.runModal()
        if choice == .alertSecondButtonReturn { return .terminateCancel }
        if choice == .alertFirstButtonReturn {
            EmbeddedTerminals.shared.detachAll()
            return .terminateNow
        }
        running.forEach { $0.stop() }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            EmbeddedTerminals.shared.detachAll()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

struct TerminalSessionControls: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var session: EmbeddedAgentSession
    @ViewState private var confirmStop = false
    var body: some View {
        Group {
            if session.ended {
                Button { EmbeddedTerminals.shared.close(session) } label: { Image(systemName: "xmark.circle") }
                    .help("Close exited terminal").accessibilityLabel("Close exited terminal")
            } else if session.stopping {
                ProgressView().controlSize(.small).help("Stopping session…")
            } else {
                Button { confirmStop = true } label: { Image(systemName: "stop.circle") }
                    .help("End session…").accessibilityLabel("End session")
            }
        }.buttonStyle(.plain)
            .alert("End this session?", isPresented: $confirmStop) {
                Button("Cancel", role: .cancel) {}
                Button("End session", role: .destructive) { session.stop() }
                if let row = session.row(in: model) {
                    Button("End and archive…", role: .destructive) {
                        model.endAndReviewArchive(session, row: row)
                    }
                }
            } message: { Text("End and archive stops this agent, then opens an archive review once it is confirmed closed. Ending may interrupt work. This stops the agent and may interrupt work. Recorded history remains available to resume.") }
    }
}

struct UnmatchedTerminalRow: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var session: EmbeddedAgentSession
    var body: some View {
        HStack {
            Button { model.presentEmbedded(session.id) } label: {
                HStack {
                    Label(session.title, systemImage: "terminal").lineLimit(2)
                    Spacer()
                    Text(session.ended ? "Ended" : "\(session.provider) · starting session").foregroundStyle(.secondary)
                }.contentShape(Rectangle())
            }.buttonStyle(.plain)
            if session.ended {
                Button { EmbeddedTerminals.shared.close(session) } label: {
                    Image(systemName: "xmark.circle").frame(width: 28, height: 28)
                }.buttonStyle(.plain).help("Dismiss ended terminal; saved conversation is unchanged")
                    .accessibilityLabel("Dismiss ended terminal")
            }
        }.padding(16)
    }
}
