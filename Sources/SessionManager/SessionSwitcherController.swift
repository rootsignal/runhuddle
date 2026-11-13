import AppKit
import SwiftUI
import Combine
import SessionCore

@MainActor final class SessionSwitcherController: NSObject, ObservableObject, NSPopoverDelegate {
    let hotKey = SwitcherHotKey()
    private var item: NSStatusItem?
    private let popover = NSPopover()
    private var subscriptions = Set<AnyCancellable>()
    private var previousApplication: NSRunningApplication?
    private weak var model: AppModel?
    private var loginItem: LoginItem?
    private var updater: AppUpdater?

    func start(model: AppModel, loginItem: LoginItem, updater: AppUpdater) {
        guard item == nil else { return }
        self.model = model; self.loginItem = loginItem; self.updater = updater
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        self.item = item
        item.button?.target = self; item.button?.action = #selector(toggle)
        popover.behavior = .transient; popover.delegate = self
        popover.animates = false
        model.$sessions.map { $0.filter { !$0.simulated && $0.state == .needsInput }.count }
            .removeDuplicates().sink { [weak self] count in self?.updateIcon(count) }.store(in: &subscriptions)
        hotKey.action = { [weak self] in self?.toggle() }; hotKey.start()
    }
    private func updateIcon(_ count: Int) {
        guard let item, let button = item.button else { return }
        let mark = RunHuddleIcon.image()
        if let badge = RunHuddleIcon.attentionBadge(count: count) {
            let width = 22 + badge.size.width
            button.image = NSImage(size: NSSize(width: width, height: 18), flipped: false) { _ in
                mark.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
                NSColor.labelColor.setFill()
                NSRect(x: 0, y: 0, width: 18, height: 18).fill(using: .sourceIn)
                badge.draw(in: NSRect(x: 22, y: 1, width: badge.size.width, height: 16))
                return true
            }
        } else { button.image = mark }
        item.length = (button.image?.size.width ?? 18) + 12
        button.toolTip = "RunHuddle · \(count) need input"
        button.setAccessibilityLabel("RunHuddle, \(count) sessions need input")
    }
    @objc func toggle() {
        if popover.isShown { dismiss(restoreFocus: true); return }
        guard let button = item?.button, let model, let loginItem, let updater else { return }
        previousApplication = NSWorkspace.shared.frontmostApplication
        // Recreate the view on each opening: query and keyboard selection are local
        // to this popover and never disturb the main window's filters or selection.
        let view = SessionSwitcherView(controller: self)
            .environmentObject(model).environmentObject(loginItem).environmentObject(updater)
            .environmentObject(hotKey)
        popover.contentViewController = NSHostingController(rootView: view)
        popover.contentSize = NSSize(width: 440, height: SessionSwitcherView.preferredHeight(sessions: model.sessions))
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        loginItem.refresh()
    }
    func dismiss(restoreFocus: Bool = false) {
        popover.performClose(nil)
        if restoreFocus, let previousApplication, previousApplication.processIdentifier != ProcessInfo.processInfo.processIdentifier {
            previousApplication.activate(options: [])
        }
    }
    func openMain() {
        dismiss(); model?.openMainWindow?(); NSApp.activate(ignoringOtherApps: true)
    }
    func openSettings() {
        dismiss(); model?.openSettingsWindow?(); NSApp.activate(ignoringOtherApps: true)
    }
    func switchTo(_ row: Session) {
        guard let model, !model.navigatingTerminal,
              let current = model.sessions.first(where: { $0.id == row.id }),
              !current.simulated, [.needsInput, .working, .idle].contains(current.state) else { return }
        model.resume(current, fromMenu: true)
    }
    func terminalDidOpen() { dismiss() }
    func popoverDidClose(_ notification: Notification) { popover.contentViewController = nil }
}
