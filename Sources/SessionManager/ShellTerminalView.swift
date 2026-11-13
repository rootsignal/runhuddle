import SwiftUI
import AppKit
import SessionCore

struct NewShellTerminalView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @ViewState private var directory: String
    @ViewState private var failure: String?
    init(initialDirectory: String) {
        _directory = ViewState(initialValue: initialDirectory.isEmpty ? NSHomeDirectory() : initialDirectory)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Open terminal", systemImage: "terminal").font(.title2.bold())
            Text("Run commands in your login shell.").foregroundStyle(.secondary)
            HStack {
                TextField("Working folder", text: $directory).textFieldStyle(.roundedBorder)
                Button("Choose…") {
                    let panel = NSOpenPanel()
                    panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
                    panel.directoryURL = URL(fileURLWithPath: (directory as NSString).expandingTildeInPath)
                    if panel.runModal() == .OK, let url = panel.url { directory = url.path }
                }
            }
            Text("Shell: " + PersistentTerminalService.loginShell).font(.caption).foregroundStyle(.secondary)
            Text("This terminal stays a shell if you start an AI agent inside it. It reconnects when RunHuddle reopens.").font(.caption).foregroundStyle(.secondary)
            if let failure { Text(failure).foregroundStyle(.orange) }
            HStack {
                Button("Cancel") { dismiss() }
                Spacer()
                Button("Open terminal") {
                    do {
                        let path = URL(fileURLWithPath: (directory as NSString).expandingTildeInPath).standardizedFileURL.path
                        model.presentEmbedded(try EmbeddedTerminals.shared.startShell(directory: path))
                        dismiss()
                    } catch { failure = error.localizedDescription }
                }.buttonStyle(.borderedProminent).disabled(directory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(24).frame(width: 500)
    }
}

struct ShellTerminalsEntry: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var terminals = EmbeddedTerminals.shared
    let matching: [EmbeddedAgentSession]
    private var selected: Bool {
        terminals.presentedID == EmbeddedTerminals.shellWorkspaceID || terminals.sessions.contains { $0.id == terminals.presentedID && $0.isShell }
    }
    var body: some View {
        Button {
            let last = UserDefaults.standard.string(forKey: "lastShellTerminalID")
            let target = matching.first { $0.id == terminals.presentedID } ?? matching.first { $0.id == last } ?? matching.first
            model.selection = nil
            model.presentEmbedded(target?.id ?? EmbeddedTerminals.shellWorkspaceID)
        } label: {
            HStack {
                Label("Terminals", systemImage: "terminal").font(.headline)
                Spacer()
                Text("\(matching.count)").monospacedDigit().foregroundStyle(.secondary)
            }.padding(14).contentShape(Rectangle())
        }.buttonStyle(.plain)
            .background(selected ? HuddleStyle.accent.opacity(0.15) : .clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(selected ? HuddleStyle.accent.opacity(0.5) : .clear))
            .accessibilityAddTraits(selected ? .isSelected : [])
            .padding(.horizontal, 12).padding(.vertical, 8)
    }
}

struct ShellTerminalTabs: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject private var terminals = EmbeddedTerminals.shared
    @ViewState private var newTerminal = false
    @ViewState private var closing: EmbeddedAgentSession?
    private var shells: [EmbeddedAgentSession] { terminals.sessions.filter(\.isShell) }
    private var current: EmbeddedAgentSession? { shells.first { $0.id == terminals.presentedID } }
    private func visibleShells(count: Int) -> [EmbeddedAgentSession] {
        var visible = Array(shells.prefix(count))
        if let current, !visible.contains(where: { $0.id == current.id }) {
            if !visible.isEmpty { visible.removeLast() }
            visible.append(current)
        }
        return visible
    }
    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geometry in
                let capacity = max(1, Int((geometry.size.width - 52 + 6) / 126))
                let overflow = shells.count > capacity
                let count = overflow ? max(1, Int((geometry.size.width - 92 + 6) / 126)) : capacity
                let visible = visibleShells(count: count)
                HStack(spacing: 6) {
                    ForEach(visible) { session in
                        ShellTerminalTab(session: session, selected: current?.id == session.id,
                            select: { model.presentEmbedded(session.id) },
                            close: { if session.ended { terminals.close(session) } else { closing = session } })
                            .frame(maxWidth: 220)
                    }
                    Spacer(minLength: 0)
                    if overflow {
                        Menu {
                            ForEach(shells) { session in
                                Button { model.presentEmbedded(session.id) } label: {
                                    if current?.id == session.id { Label(session.title, systemImage: "checkmark") }
                                    else { Text(session.title) }
                                }
                            }
                        } label: { Image(systemName: "chevron.down").frame(width: 24, height: 28) }
                            .menuIndicator(.hidden).fixedSize().help("All terminal tabs")
                            .accessibilityLabel("All terminal tabs")
                    }
                    Button { newTerminal = true } label: { Image(systemName: "plus").frame(width: 30, height: 28) }
                        .buttonStyle(.plain).fixedSize().help("New terminal tab").accessibilityLabel("New terminal tab")
                }.padding(8)
            }.frame(height: 48)
            Divider()
            if let current {
                ShellTerminalWorkspace(session: current).id(current.id)
            } else {
                ContentUnavailableView {
                    Label("Terminals", systemImage: "terminal")
                } description: {
                    Text("Open a shell to run commands. Each terminal gets its own tab.")
                } actions: {
                    Button("Open terminal…") { newTerminal = true }.buttonStyle(.borderedProminent)
                }
            }
        }
        .sheet(isPresented: $newTerminal) { NewShellTerminalView(initialDirectory: current?.directory ?? "") }
        .alert("Close this terminal?", isPresented: Binding(get: { closing != nil }, set: { if !$0 { closing = nil } })) {
            Button("Cancel", role: .cancel) { closing = nil }
            Button("End and close", role: .destructive) {
                guard let session = closing else { return }
                session.stop()
                if session.ended { terminals.close(session) }
                else { model.error = session.stopFailure ?? "The terminal has not stopped. Its tab remains open." }
                closing = nil
            }
        } message: {
            Text("Closing \(closing?.title ?? "this terminal") ends its shell and interrupts attached commands, including any agent running inside it. Detached background processes may keep running.")
        }
    }
}

private struct ShellTerminalTab: View {
    @EnvironmentObject private var model: AppModel
    @ViewState private var confirmStop = false
    @ViewState private var renaming = false
    @ViewState private var name = ""
    @ObservedObject var session: EmbeddedAgentSession
    let selected: Bool
    let select: () -> Void
    let close: () -> Void
    var body: some View {
        HStack(spacing: 2) {
            Button(action: select) {
                HStack(spacing: 5) {
                    Image(systemName: session.ended ? "checkmark.circle" : "terminal")
                    Text(session.title.hasPrefix("Shell · ") ? String(session.title.dropFirst(8)) : session.title).lineLimit(1).truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.padding(.leading, 10).padding(.vertical, 8)
            }.buttonStyle(.plain).accessibilityLabel(session.title).accessibilityAddTraits(selected ? .isSelected : [])
            Button(action: close) { Image(systemName: "xmark").frame(width: 26, height: 28) }
                .buttonStyle(.plain).help("Close terminal tab").accessibilityLabel("Close " + session.title)
        }.font(.callout).frame(maxWidth: .infinity)
            .background(selected ? HuddleStyle.accent.opacity(0.18) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
            .help(session.title + "\n" + session.directory + (session.ended ? "\nEnded" : ""))
            .contextMenu {
                    Button("Rename terminal…") { name = session.title; renaming = true }
                    Button("Show folder in Finder") { NSWorkspace.shared.open(URL(fileURLWithPath: session.directory)) }
                    Button("Copy folder path") { model.copy(session.directory) }
                    Divider()
                    if session.ended {
                        Button("Close ended terminal") { EmbeddedTerminals.shared.close(session) }
                    } else {
                        Button("End terminal…", role: .destructive) { confirmStop = true }
                    }

            }
        .alert("End this terminal?", isPresented: $confirmStop) {
            Button("Cancel", role: .cancel) {}
            Button("End terminal", role: .destructive) { session.stop() }
        } message: { Text("This closes the shell and interrupts commands using this terminal. Detached background processes may keep running.") }
        .sheet(isPresented: $renaming) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Rename terminal").font(.headline)
                TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Cancel") { renaming = false }; Spacer()
                    Button("Save") {
                        do { try session.renameShell(name); renaming = false }
                        catch { model.error = error.localizedDescription }
                    }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }.padding(24).frame(width: 360)
        }
    }
}

struct ShellTerminalWorkspace: View {
    @EnvironmentObject private var model: AppModel
    @ObservedObject var session: EmbeddedAgentSession
    @ViewState private var showOutput = false
    var body: some View {
        VStack(spacing: 0) {
            if let row = EmbeddedTerminals.shared.linkedRow(for: session, model: model) {
                HStack {
                    Text(row.provider + " · " + model.displayName(for: row)).lineLimit(1)
                    Spacer()
                    Text(row.state.title)
                }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).padding(.bottom, 8)
            }
            Divider()
            if let failure = session.stopFailure { Text(failure).font(.caption).foregroundStyle(.orange).padding(8) }
            if session.ended && !showOutput {
                VStack(spacing: 16) {
                    Label("Terminal ended", systemImage: "terminal").font(.title2.bold())
                    Text("Start a new shell in this folder or view its remaining terminal output.").foregroundStyle(.secondary)
                    HStack {
                        Button("Show terminal output") { showOutput = true }
                        Button("Open new terminal") {
                            do { model.presentEmbedded(try EmbeddedTerminals.shared.startShell(directory: session.directory)) }
                            catch { model.error = error.localizedDescription }
                        }.buttonStyle(.borderedProminent)
                        Button("Close") { EmbeddedTerminals.shared.close(session) }
                    }
                }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                if session.ended {
                    HStack { Text("Terminal ended · output is read-only"); Spacer(); Button("Back") { showOutput = false } }.font(.caption).padding(8)
                }
                EmbeddedTerminalHost(session: session).frame(maxWidth: .infinity, maxHeight: .infinity)
                    .allowsHitTesting(!session.ended)
            }
            Text(session.directory).font(.caption).foregroundStyle(.secondary).lineLimit(1).padding(8)
        }.background(HuddleStyle.panel)

    }
}
