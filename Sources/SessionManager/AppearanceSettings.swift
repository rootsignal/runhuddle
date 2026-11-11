import SwiftUI

enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

struct AppearancePicker: View {
    @AppStorage("appearance") private var appearance = AppAppearance.system.rawValue

    var body: some View {
        Picker("Appearance", selection: $appearance) {
            ForEach(AppAppearance.allCases) { option in
                Text(option.title).tag(option.rawValue)
            }
        }
    }
}

struct AppearanceSettings: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Appearance", systemImage: "circle.lefthalf.filled")
                .font(.title2.bold())
            AppearancePicker().pickerStyle(.segmented).labelsHidden()
            Text("System follows your Mac’s appearance. Light and Dark apply only to RunHuddle.")
                .font(.callout).foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(width: 380)
        .tint(HuddleStyle.accent)
    }
}
