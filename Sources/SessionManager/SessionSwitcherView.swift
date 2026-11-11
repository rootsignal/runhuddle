import SwiftUI
import SessionCore

struct SessionSwitcherView: View {
    let controller: SessionSwitcherController
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var loginItem: LoginItem
    @EnvironmentObject var updater: AppUpdater
    @EnvironmentObject var hotKey: SwitcherHotKey
    @ViewState private var query = ""
    @ViewState private var selected: String?
    @FocusState private var searchFocused: Bool
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue
    private var rows: [Session] { SessionSwitcher.rows(model.sessions, query: query, names: model.displayNames) }
    private var summary: SessionMenu { SessionMenu(sessions: model.sessions, alerts: []) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 10) {
                    Image(nsImage: RunHuddleIcon.image(size: 32, appTile: true)).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("RunHuddle").font(.system(size: 20, weight: .semibold, design: .rounded))
                        Text("\(summary.needsInput.count) need you · \(summary.working.count) working · \(summary.idle.count) idle")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                HStack {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Find a session…", text: $query).textFieldStyle(.plain)
                        .focused($searchFocused).onSubmit { activateSelected() }
                        .onExitCommand { controller.dismiss(restoreFocus: true) }
                        .accessibilityLabel("Find an active session")
                    if !query.isEmpty {
                        Button { query = ""; searchFocused = true } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).help("Clear search").accessibilityLabel("Clear search")
                    }
                }.padding(10).background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 8))
                if model.connectionNeedsAttention {
                    Text("Some agents are unavailable. Showing last known activity.").font(.caption).foregroundStyle(.orange)
                }
            }.padding(18)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach([SessionState.needsInput, .working, .idle], id: \.self) { state in
                            let group = rows.filter { $0.state == state }
                            if !group.isEmpty {
                                Text(state == .needsInput ? "NEEDS YOU" : state.title.uppercased())
                                    .font(.system(size: 10, weight: .semibold)).tracking(0.8)
                                    .foregroundStyle(state == .needsInput ? state.color : .secondary)
                                    .padding(.horizontal, 10).padding(.top, 12).padding(.bottom, 5)
                                ForEach(group) { row in
                                    Button { controller.switchTo(row) } label: {
                                        SwitcherSessionRow(row: row, title: model.displayName(for: row), selected: selected == row.id,
                                                           busy: model.navigatingTerminal && model.terminalNavigationSessionID == row.id)
                                    }.buttonStyle(.plain).disabled(model.navigatingTerminal)
                                        .help("Switch to terminal · \(row.cwd)")
                                        .accessibilityLabel("\(model.displayName(for: row)), \(row.provider), \(row.state.title). Switch to terminal")
                                        .id(row.id)
                                }
                            }
                        }
                        if rows.isEmpty {
                            VStack(spacing: 10) {
                                Image(systemName: query.isEmpty ? "moon" : "magnifyingglass").font(.title2).foregroundStyle(.secondary)
                                Text(query.isEmpty ? "No active sessions" : "No matching sessions").font(.headline)
                                Text("Open RunHuddle to browse saved sessions and history.").font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            }.frame(maxWidth: .infinity).padding(.vertical, 36)
                        }
                    }.padding(.horizontal, 10).padding(.bottom, 12)
                }
                .onChange(of: selected) { _, id in if let id { proxy.scrollTo(id) } }
                .onKeyPress(.downArrow) { move(1); return .handled }
                .onKeyPress(.upArrow) { move(-1); return .handled }
            }
            Divider()
            HStack {
                Button { controller.openMain() } label: { Label("Open RunHuddle", systemImage: "macwindow") }
                    .buttonStyle(.plain)
                Spacer()
                Menu {
                    Button("Connections…") { model.showSetup = true; controller.openMain() }
                    Menu("Appearance") { AppearancePicker() }
                    Toggle("Global shortcut: \(hotKey.shortcut.label)", isOn: Binding(get: { hotKey.enabled }, set: { hotKey.setEnabled($0) }))
                    Button("Settings…") { controller.openSettings() }
                    Toggle("Open at Login", isOn: Binding(get: { loginItem.enabled }, set: { loginItem.setEnabled($0) }))
                    if loginItem.needsApproval { Button("Allow in Login Items Settings…") { loginItem.openSettings() } }
                    if let error = loginItem.error { Text(error) }
                    Button("Check for Updates…") { controller.dismiss(); updater.check() }.disabled(!updater.canCheck)
                    Button("Refresh activity") { Task { await model.refresh(userInitiated: true) } }.disabled(model.refreshing)
                    Divider()
                    Button("Quit RunHuddle") { NSApp.terminate(nil) }
                } label: { Image(systemName: "gearshape") }
                    .menuStyle(.borderlessButton).fixedSize().help("RunHuddle settings and actions")
            }.padding(.horizontal, 18).padding(.top, 14)
            Text(model.navigatingTerminal ? model.terminalProgress : "↑ ↓ to choose · Return to switch · Esc to dismiss")
                .font(.system(size: 10)).foregroundStyle(.secondary).padding(.vertical, 10)
        }.frame(width: 440, height: 590)
            .background(HuddleStyle.canvas).tint(HuddleStyle.accent)
            .preferredColorScheme(AppAppearance(rawValue: appearance)?.colorScheme)
            .onAppear { searchFocused = true; selected = rows.first?.id }
            .onChange(of: query) { _, _ in selected = rows.first?.id }
            .onChange(of: rows.map(\.id)) { _, ids in if selected == nil || !ids.contains(selected!) { selected = ids.first } }
            .onKeyPress(.downArrow) { move(1); return .handled }
            .onKeyPress(.upArrow) { move(-1); return .handled }
            .onKeyPress(.escape) { controller.dismiss(restoreFocus: true); return .handled }
    }
    private func move(_ offset: Int) { selected = SessionSwitcher.movedSelection(selected, by: offset, rows: rows) }
    private func activateSelected() {
        if let row = rows.first(where: { $0.id == selected }) { controller.switchTo(row) }
    }
}

struct SwitcherSessionRow: View {
    let row: Session
    let title: String
    let selected: Bool
    let busy: Bool
    @ViewState private var hovered = false
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: row.state == .idle ? "circle" : "circle.fill")
                .font(.system(size: 9)).foregroundStyle(row.state.color).frame(width: 12)
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Text("\(row.project) · \(row.provider)").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 5)
            if busy { ProgressView().controlSize(.small) }
            else { Image(systemName: "arrow.up.forward").font(.system(size: 11)).foregroundStyle(.secondary) }
        }.padding(.horizontal, 10).padding(.vertical, 10)
            .background((selected || hovered) ? (row.state == .needsInput ? row.state.color.opacity(0.13) : HuddleStyle.accent.opacity(0.1)) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle()).onHover { hovered = $0 }
    }
}
