import AppKit
import SwiftUI

/// Track the actual Settings scene window without relying on SwiftUI's private identifiers.
@MainActor
struct SettingsWindowTracker: NSViewRepresentable {
    private static weak var settingsWindow: NSWindow?

    static func closeIfVisible() -> Bool {
        guard let window = settingsWindow, window.isVisible || window.isMiniaturized else { return false }
        window.performClose(nil)
        return true
    }

    func makeNSView(context: Context) -> WindowProbe { WindowProbe() }
    func updateNSView(_ nsView: WindowProbe, context: Context) {}

    final class WindowProbe: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window { SettingsWindowTracker.settingsWindow = window }
        }
    }
}
