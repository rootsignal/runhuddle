import AppKit
import SwiftUI
import SessionCore
struct PreviewContent: View {
 let row = Session(provider: "Codex", sessionID: "demo", title: "Website redesign", cwd: "/work/website", state: .idle)
 var body: some View {
  WorkspaceLayout(sidebarVisible: true) {
   VStack(alignment: .leading, spacing: 24) {
    Text("WORKSPACE").font(.caption)
    ForEach(["Now", "Pinned", "All sessions", "Needs input", "Working", "Idle"], id: \.self) { Text($0) }
    Spacer()
   }.frame(maxWidth: .infinity, alignment: .leading).padding(18).background(HuddleStyle.panel)
  } detail: {
   VStack(alignment: .leading, spacing: 0) {
    Text("Now").font(.title).padding(24)
    SessionColumns(showDetails: true) {
     VStack { SessionCardContent(row: row, title: row.title, summary: "Updated navigation and checked the responsive layout.", match: nil, pinned: false); Spacer() }.padding(20)
    } detail: {
     VStack(alignment: .leading, spacing: 10) {
      HStack { Text("SESSION DETAILS"); Spacer(); Image(systemName: "xmark") }.font(.caption)
      Text(row.title).font(.title2)
      HStack { Button("Go to terminal") {}; Spacer(); Image(systemName: "folder"); Image(systemName: "pin") }
      RepositoryContextView(directory: FileManager.default.currentDirectoryPath)
      Text("Overview    Handoff").font(.caption).foregroundStyle(.secondary)
      RecordedMessageCard(title: "LATEST RESPONSE", value: "Updated navigation and checked the responsive layout. This longer response should wrap within the current detail column without pushing the sidebar outside the window.")
      Spacer()
     }.padding(24).background(HuddleStyle.panel)
    }
   }.background(HuddleStyle.canvas)
  }.environment(\.colorScheme, .dark)
 }
}
@main struct Preview {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  NSApp.appearance = NSAppearance(named: .darkAqua)
  let host = NSHostingView(rootView: PreviewContent())
  let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 680), styleMask: .borderless, backing: .buffered, defer: false)
  window.contentView = host
  for width in [1320, 900, 760, 1320] {
   window.setContentSize(NSSize(width: width, height: 680))
   host.frame = NSRect(x: 0, y: 0, width: width, height: 680)
   host.layoutSubtreeIfNeeded()
   RunLoop.current.run(until: Date().addingTimeInterval(1))
   let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
   host.cacheDisplay(in: host.bounds, to: bitmap)
   try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(CommandLine.arguments[1])/resize-\(width).png"))
  }
 }
}
