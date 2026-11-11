import SwiftUI

struct NotificationSettingsView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Form {
            Section("Alerts") {
                Toggle("Sessions needing input", isOn: $model.notificationPreferences.input)
                Toggle("Work ready for review", isOn: $model.notificationPreferences.completion)
                Toggle("Play a sound", isOn: $model.notificationPreferences.sound)
                Picker("Remind me once after", selection: $model.notificationPreferences.reminderMinutes) {
                    Text("Never").tag(0)
                    Text("5 minutes waiting").tag(5)
                    Text("10 minutes waiting").tag(10)
                    Text("15 minutes waiting").tag(15)
                }
                Text("Updates arriving together are combined into one alert. Reminders apply only while input is still needed.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Quiet time") {
                Toggle("Quiet hours", isOn: $model.notificationPreferences.quietHours)
                HStack {
                    Picker("From", selection: $model.notificationPreferences.quietStart) {
                        ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) }
                    }
                    Picker("Until", selection: $model.notificationPreferences.quietEnd) {
                        ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) }
                    }
                }.disabled(!model.notificationPreferences.quietHours)
                Text("Uses your Mac’s local time. Matching start and end hours silence alerts all day.").font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Snooze 1 hour") { model.notificationPreferences.snoozedUntil = Date().addingTimeInterval(3600).timeIntervalSince1970 }
                    if model.notificationPreferences.snoozedUntil > Date().timeIntervalSince1970 {
                        Button("Resume alerts") { model.notificationPreferences.snoozedUntil = 0 }
                    }
                }
                if model.notificationPreferences.snoozedUntil > Date().timeIntervalSince1970 {
                    Text("Snoozed until \(Date(timeIntervalSince1970: model.notificationPreferences.snoozedUntil), style: .time)").font(.caption)
                }
            }
            Section("Muted projects") {
                if model.notificationPreferences.mutedProjects.isEmpty {
                    Text("Mute a project from its session’s details. Tracking stays active.").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(model.notificationPreferences.mutedProjects.sorted(), id: \.self) { path in
                    HStack {
                        Text(path.replacingOccurrences(of: NSHomeDirectory(), with: "~")).lineLimit(2).help(path)
                        Spacer()
                        Button("Unmute") { model.notificationPreferences.mutedProjects.remove(path) }
                    }
                }
            }
            Section {
                Button("macOS notification settings…") { model.openNotificationSettings() }
                Button("Send test alert") { Task { await model.testNotification() } }
                Text("Test alerts bypass quiet hours and snooze. macOS notification permission is still required.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).frame(width: 500, height: 590)
    }
}
