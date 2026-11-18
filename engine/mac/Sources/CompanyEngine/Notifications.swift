import AppKit
import UserNotifications
import EngineShell

// D5: local notifications that say only a count (Notifier.words) under the title W17, no sound. Permission
// is asked the first time a rise is seen, never at launch; once refused it is never asked again and the
// switch is greyed. Clicking one opens the window on Needs you.
@MainActor
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    var onOpen: (() -> Void)?
    private(set) var refused = false
    private var asking = false

    /// Notifications need a bundle; a bare build of the program (no .app) has none and posts nothing.
    private var center: UNUserNotificationCenter? {
        Bundle.main.bundleIdentifier == nil ? nil : UNUserNotificationCenter.current()
    }

    func start() {
        guard let center else { return }
        center.delegate = self
        center.getNotificationSettings { settings in
            let denied = settings.authorizationStatus == .denied
            DispatchQueue.main.async { self.refused = denied }
        }
    }

    func post(_ words: String) {
        guard let center, !refused, !asking else { return }
        center.getNotificationSettings { settings in
            let status = settings.authorizationStatus
            DispatchQueue.main.async { self.post(words, status: status) }
        }
    }

    private func post(_ words: String, status: UNAuthorizationStatus) {
        guard let center else { return }
        switch status {
        case .notDetermined:
            asking = true
            center.requestAuthorization(options: [.alert]) { granted, _ in
                DispatchQueue.main.async {
                    self.asking = false
                    if granted { self.deliver(words) } else { self.refused = true }
                }
            }
        case .denied:
            refused = true
        default:
            deliver(words)
        }
    }

    private func deliver(_ words: String) {
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = NativeWords.notificationTitle
        content.body = words
        content.sound = nil
        // One at a time: a newer count replaces the last one.
        let request = UNNotificationRequest(identifier: "needs-you", content: content, trigger: nil)
        center.add(request, withCompletionHandler: nil)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated { self.onOpen?() }
            completionHandler()
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }
}
