// Documentation-only fixture. Compiles the production switcher with inert dependencies.
// Never reads session files, launches agents, or registers shortcuts.
import AppKit
import SwiftUI
import SessionCore

@MainActor final class AppModel: ObservableObject {
    @Published var sessions: [Session] = {
        var question = Session(provider: "Claude", sessionID: "example-website", title: "Website redesign", cwd: "/work/website", state: .needsInput)
        question.attention = AttentionRequest(kind: "question", detail: "Which navigation layout should we use?\nSidebar or top navigation?")
        return [question,
                Session(provider: "Codex", sessionID: "example-api", title: "API cleanup", cwd: "/work/api-service", state: .working),
                Session(provider: "Copilot", sessionID: "example-tests", title: "Add checkout tests", cwd: "/work/storefront", state: .idle)]
    }()
    var displayNames: [String: String] = [:]
    var connectionNeedsAttention = false
    var navigatingTerminal = false
    var terminalNavigationSessionID: String?
    var terminalProgress = ""
    var showSetup = false
    var refreshing = false
    var notificationPreferences = NotificationPreferences()
    func displayName(for row: Session) -> String { row.title }
    func refresh(userInitiated: Bool) async {}
}
@MainActor final class SessionSwitcherController {
    func dismiss(restoreFocus: Bool = false) {}
    func switchTo(_ row: Session) {}
    func openMain() {}
    func openSettings() {}
}
@MainActor final class LoginItem: ObservableObject {
    var enabled = false
    var needsApproval = false
    var error: String?
    func setEnabled(_ value: Bool) {}
    func openSettings() {}
}
@MainActor final class AppUpdater: ObservableObject {
    var canCheck = false
    func check() {}
}
@MainActor final class SwitcherHotKey: ObservableObject {
    var enabled = true
    var shortcut = SwitcherShortcut.standard
    func setEnabled(_ value: Bool) {}
}
enum AppAppearance: String {
    case system, light, dark
    var colorScheme: ColorScheme? { self == .light ? .light : .dark }
}
struct AppearancePicker: View { var body: some View { Text("Dark") } }

struct ScreenshotScene: View {
    let model: AppModel
    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(red: 0.055, green: 0.065, blue: 0.085)
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    ForEach([Color.red, .yellow, .green], id: \.self) { color in Circle().fill(color.opacity(0.8)).frame(width: 10, height: 10) }
                    Spacer()
                    Text("api-service — terminal").font(.system(size: 12)).foregroundStyle(.secondary)
                    Spacer()
                }.padding(16).background(Color.white.opacity(0.04))
                HStack(spacing: 28) {
                    Text("website").foregroundStyle(.secondary)
                    Text("api-service").foregroundStyle(.white)
                    Text("storefront").foregroundStyle(.secondary)
                    Spacer()
                }.font(.system(size: 11, weight: .medium)).padding(14).background(Color.white.opacity(0.025))
                VStack(alignment: .leading, spacing: 17) {
                    Text("~/work/api-service  main").foregroundStyle(Color.cyan.opacity(0.75))
                    Text("❯ codex").foregroundStyle(.white.opacity(0.85))
                    Text("› Clean up the API handlers and\n  add coverage for error responses.").foregroundStyle(.white.opacity(0.8))
                    Text("• Reviewing routes and existing tests…").foregroundStyle(.white.opacity(0.5))
                    Text("  api/routes/health.ts\n  api/routes/orders.ts\n  tests/api/errors.test.ts").foregroundStyle(.white.opacity(0.45))
                    Spacer()
                    Text("Working · updating error handling").foregroundStyle(Color.cyan.opacity(0.65))
                }.font(.system(size: 12, design: .monospaced)).lineSpacing(7)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(24)
            }.frame(width: 870, height: 610).background(Color.black.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.white.opacity(0.12)))
                .offset(x: 26, y: 42)
            SessionSwitcherView(controller: SessionSwitcherController())
                .environmentObject(model).environmentObject(LoginItem())
                .environmentObject(AppUpdater()).environmentObject(SwitcherHotKey())
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.white.opacity(0.22)))
                .shadow(color: .black.opacity(0.5), radius: 20, y: 10)
                .offset(x: 450, y: 22)
            Text("EXAMPLE SESSIONS · STAGED TERMINAL")
                .font(.system(size: 9, weight: .medium)).tracking(1).foregroundStyle(.white.opacity(0.45))
                .offset(x: 28, y: 670)
        }.frame(width: 930, height: 700).environment(\.colorScheme, .dark)
    }
}

@main struct Screenshot {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingView(rootView: ScreenshotScene(model: AppModel()))
        host.appearance = NSAppearance(named: .darkAqua)
        host.frame = NSRect(x: 0, y: 0, width: 930, height: 700)
        // Offscreen only: never order this window onto the user's desktop.
        let window = NSWindow(contentRect: host.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds),
              CommandLine.arguments.count == 2 else { fatalError("Expected output PNG path") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    }
}
