import SwiftUI

struct WorkspacePaneControls: View {
    let listVisible: Bool
    let infoVisible: Bool
    let canToggleList: Bool
    let canToggleInfo: Bool
    let toggleList: () -> Void
    let toggleInfo: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            paneButton("Session list", symbol: "sidebar.left", visible: listVisible,
                       enabled: canToggleList, shortcut: "⌘⇧L", action: toggleList)
            paneButton("Session info", symbol: "sidebar.right", visible: infoVisible,
                       enabled: canToggleInfo, shortcut: "⌘⇧I", action: toggleInfo)
        }
    }

    private func paneButton(_ name: String, symbol: String, visible: Bool, enabled: Bool,
                            shortcut: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .frame(width: 34, height: 28)
                .foregroundStyle(visible ? HuddleStyle.accent : Color.secondary)
                .background(visible ? HuddleStyle.accent.opacity(0.15) : Color.primary.opacity(0.04),
                            in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help("\(visible ? "Hide" : "Show") \(name.lowercased()) (\(shortcut))")
        .accessibilityLabel("\(visible ? "Hide" : "Show") \(name.lowercased())")
        .accessibilityValue(visible ? "Shown" : "Hidden")
    }
}

struct WorkspaceViewActions {
    let listVisible: Bool
    let infoVisible: Bool
    let canToggleList: Bool
    let canToggleInfo: Bool
    let canRefresh: Bool
    let toggleList: () -> Void
    let toggleInfo: () -> Void
    let refresh: () -> Void
}

private struct WorkspaceViewActionsKey: FocusedValueKey {
    typealias Value = WorkspaceViewActions
}
extension FocusedValues {
    var workspaceViewActions: WorkspaceViewActions? {
        get { self[WorkspaceViewActionsKey.self] }
        set { self[WorkspaceViewActionsKey.self] = newValue }
    }
}

struct WorkspaceViewCommands: Commands {
    @FocusedValue(\.workspaceViewActions) private var actions
    var body: some Commands {
        CommandGroup(after: .sidebar) {
            Toggle("Show session list", isOn: Binding(
                get: { actions?.listVisible ?? false }, set: { _ in actions?.toggleList() }))
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(actions?.canToggleList != true)
            Toggle("Show session info", isOn: Binding(
                get: { actions?.infoVisible ?? false }, set: { _ in actions?.toggleInfo() }))
                .keyboardShortcut("i", modifiers: [.command, .shift])
                .disabled(actions?.canToggleInfo != true)
            Divider()
            Button("Refresh session data") { actions?.refresh() }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(actions?.canRefresh != true)
        }
    }
}
