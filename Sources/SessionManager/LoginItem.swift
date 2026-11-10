import Foundation
import ServiceManagement

@MainActor final class LoginItem: ObservableObject {
    @Published private(set) var enabled = false
    @Published private(set) var needsApproval = false
    @Published private(set) var error: String?

    init() { refresh() }
    func refresh() {
        let status = SMAppService.mainApp.status
        enabled = status == .enabled || status == .requiresApproval
        needsApproval = status == .requiresApproval
    }
    func setEnabled(_ value: Bool) {
        do {
            if value { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            error = nil
        } catch {
            self.error = "Could not change Open at Login: \(error.localizedDescription)"
        }
        refresh()
    }
    func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}
