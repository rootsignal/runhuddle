import AppKit
import UserNotifications

final class AttentionDelegate: NSObject, UNUserNotificationCenterDelegate {
    var onSelect: ((String, Bool) -> Void)?
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let identifier = response.notification.request.identifier
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier else { completionHandler(); return }
        let goToTerminal = response.actionIdentifier != "viewSession"
        DispatchQueue.main.async { [weak self] in
            NSApp.activate(ignoringOtherApps: true)
            self?.onSelect?(identifier, goToTerminal)
            completionHandler()
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
