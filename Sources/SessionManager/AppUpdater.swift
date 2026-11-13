import AppKit
import Combine
import Sparkle
import SwiftUI

@MainActor final class AppUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published var canCheck = false
    private var controller: SPUStandardUpdaterController?
    override init() {
        super.init()
        guard Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil else { controller = nil; return }
        let controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
        self.controller = controller
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
    }
    func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) {
        EmbeddedTerminals.shared.updating = true
    }
    func updaterWillRelaunchApplication(_ updater: SPUUpdater) {
        EmbeddedTerminals.shared.updating = true
        EmbeddedTerminals.shared.detachAll()
    }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        EmbeddedTerminals.shared.updating = false
    }
    var checksAutomatically: Bool {
        get { controller?.updater.automaticallyChecksForUpdates ?? false }
        set { controller?.updater.automaticallyChecksForUpdates = newValue; objectWillChange.send() }
    }
    func check() {
        NSApp.activate(ignoringOtherApps: true)
        controller?.checkForUpdates(nil)
    }
}

struct UpdateButton: View {
    @EnvironmentObject var updater: AppUpdater
    var body: some View {
        Button("Check for Updates…") { updater.check() }.disabled(!updater.canCheck)
    }
}
