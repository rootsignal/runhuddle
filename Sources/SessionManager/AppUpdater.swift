import AppKit
import Combine
import Sparkle
import SwiftUI

@MainActor final class AppUpdater: ObservableObject {
    @Published var canCheck = false
    private let controller: SPUStandardUpdaterController?
    init() {
        guard Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") != nil else { controller = nil; return }
        let controller = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        self.controller = controller
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
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
