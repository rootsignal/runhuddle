// Inert fixtures using production layout and presentation components. No live sessions.
import AppKit
import SwiftUI
import SessionCore
struct PreviewContent: View {
 let scheme: ColorScheme
 private var rows: [Session] {
  var a = Session(provider: "Claude", sessionID: "a", title: "Polish checkout navigation", cwd: "/work/storefront", state: .needsInput)
  a.contextUsage = ContextUsage(used: 65000, limit: 100000)
  var b = Session(provider: "Codex", sessionID: "b", title: "Make the API easier to use", cwd: "/work/api-service", state: .working)
  b.contextUsage = ContextUsage(used: 88000, limit: 100000)
  return [a, b, Session(provider: "Copilot", sessionID: "c", title: "Add checkout tests", cwd: "/work/storefront", state: .idle)]
 }
 var body: some View {
  WorkspaceLayout(sidebarVisible: true) {
   VStack(alignment: .leading, spacing: 22) {
    Text("SESSIONS").font(.caption).foregroundStyle(.secondary)
    ForEach(["Now", "Pinned", "All sessions", "Archived"], id: \.self) { name in
     Label(name, systemImage: name == "Now" ? "sparkle" : name == "Pinned" ? "pin" : name == "Archived" ? "archivebox" : "rectangle.stack").font(.system(size: 13)).padding(8)
    }
    Divider()
    Text("LIBRARY").font(.caption).foregroundStyle(.secondary)
    Label("Saved work", systemImage: "books.vertical").font(.system(size: 13))
    DisclosureGroup("Icon guide") { Text("Context ring · observed compactions · saved work") }
    Spacer()
    Label("Settings…", systemImage: "gearshape")
   }.frame(maxWidth: .infinity, alignment: .leading).padding(18).background(HuddleStyle.canvas)
  } detail: {
   VStack(alignment: .leading, spacing: 0) {
    VStack(alignment: .leading, spacing: 6) {
     Text("Now").font(.system(size: 22, weight: .semibold, design: .rounded))
     Text("Pick up where you left off.").font(.caption).foregroundStyle(.secondary)
     ActivityOverview(sessions: rows)
    }.padding(20)
    SessionColumns(showDetails: true) {
     VStack(spacing: 12) {
      ForEach(rows) { row in
       SessionCardContent(row: row, title: row.title, summary: "Updated navigation and checked the responsive layout.", match: nil, pinned: row.id == "a", handoffStatus: "Handoff ready", savedWorkCount: 1)
        .modifier(SessionCardSurface(selected: row.id == "a"))
      }
      Spacer()
     }.padding(14)
    } detail: {
     VStack(alignment: .leading, spacing: 12) {
      HStack { Text("SESSION DETAILS"); Spacer(); Button {} label: { Image(systemName: "xmark") }.buttonStyle(QuietIconButtonStyle()) }.font(.caption).foregroundStyle(.secondary)
      HStack { SessionStatusBadge(state: .needsInput); Spacer(); AgentBadge(provider: "Claude") }
      Text(rows[0].title).font(.system(size: 20, weight: .semibold, design: .rounded))
      Label("storefront", systemImage: "folder").font(.callout).foregroundStyle(HuddleStyle.accent)
      Label("main · 3 changed", systemImage: "arrow.triangle.branch").font(.caption).foregroundStyle(.secondary)
      HStack { Button {} label: { Label("Go to terminal", systemImage: "terminal") }.buttonStyle(.borderedProminent).tint(HuddleStyle.action); Button {} label: { Image(systemName: "pin") }.buttonStyle(QuietIconButtonStyle()) }
      Picker("Session section", selection: .constant("Activity")) { Text("Activity").tag("Activity"); Text("Handoff").tag("Handoff"); Text("Details").tag("Details") }.pickerStyle(.segmented).labelsHidden()
      RecordedMessageCard(title: "LATEST RESPONSE", value: "The new navigation is ready to review. **Two options** are available: a compact sidebar or a top navigation bar. Which would you prefer?")
      DisclosureGroup("Latest request") { Text("Review the navigation options.") }
      DisclosureGroup("Your notes") { TextField("Next step", text: .constant("")) }
      Spacer()
     }.padding(18).background(HuddleStyle.panel)
    }
   }.background(HuddleStyle.canvas)
  }.environment(\.colorScheme, scheme).tint(HuddleStyle.accent).disclosureGroupStyle(HuddleDisclosureStyle())
 }
}
@main struct Preview {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  for scheme in [ColorScheme.dark, .light] {
   NSApp.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
   let host = NSHostingView(rootView: PreviewContent(scheme: scheme))
   let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 720), styleMask: .borderless, backing: .buffered, defer: false)
   window.contentView = host
   for width in [1320, 900, 760, 1320] {
    window.setContentSize(NSSize(width: width, height: 720))
    host.frame = NSRect(x: 0, y: 0, width: width, height: 720)
    host.layoutSubtreeIfNeeded()
    RunLoop.current.run(until: Date().addingTimeInterval(0.3))
    let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
    host.cacheDisplay(in: host.bounds, to: bitmap)
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(CommandLine.arguments[1])/\(scheme == .dark ? "dark" : "light")-\(width).png"))
   }
  }
 }
}
