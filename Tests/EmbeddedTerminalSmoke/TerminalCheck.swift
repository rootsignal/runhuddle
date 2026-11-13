import AppKit
import SwiftUI
import SwiftTerm
import SessionCore
@MainActor final class AppModel: ObservableObject {
 var sessions: [Session] = []
 var error: String?
 var selection: String?
 func embeddedProcessExited(_ row: Session, unexpected: Bool = false) {}
 func synchronizePresentedTerminalSelection() {}
 func showSession(_ id: String) {}
 func resume(_ row: Session) {}
 func refresh() async {}
 func presentEmbedded(_ id: String) {}
 func endAndReviewArchive(_ terminal: EmbeddedAgentSession, row: Session) {}
 func prepareBulkCleanup(_ operation: String, rows: [Session]) async {}
 func executable(for row: Session) -> String? { "/bin/sh" }
 func displayName(for row: Session) -> String { row.title }
}
@MainActor enum ProjectCommandRunner { static var active: [Int32: Process] = [:]; static func stopAll() {} }
struct ConversationActivity: View { let row: Session; var body: some View { Text(row.title) } }
@main struct TerminalCheck {
 @MainActor static func main() throws {
  _ = NSApplication.shared
  let preferences = TerminalPreferences.shared
  let original = preferences.value
  defer { preferences.value = original }
  preferences.value = TerminalOptionsPreference()
  let legacy = try JSONDecoder().decode(TerminalOptionsPreference.self, from: Data(#"{"font":"Monaco","size":16,"theme":"Warm","cursor":"steadyBar","scrollback":1000,"optionAsMeta":true}"#.utf8))
  precondition(legacy.font == "Monaco" && legacy.size == 16 && legacy.theme == "Warm" && legacy.optionAsMeta)
  precondition(legacy.contrast == 0.45 && legacy.saturation == 0.60, "Old settings must migrate without resetting font or theme")
  func luminance(_ color: NSColor) -> Double {
   let c = color.usingColorSpace(.sRGB)!
   func linear(_ v: CGFloat) -> Double { v <= 0.04045 ? Double(v) / 12.92 : pow((Double(v) + 0.055) / 1.055, 2.4) }
   return 0.2126 * linear(c.redComponent) + 0.7152 * linear(c.greenComponent) + 0.0722 * linear(c.blueComponent)
  }
  for name in TerminalOptionsPreference.themes {
   for dark in [true, false] {
    for contrast in [0.0, 0.45, 1.0] {
     var preset = TerminalOptionsPreference(); preset.selectTheme(name); preset.contrast = contrast
     let colors = preset.colors(dark: dark)
     let a = luminance(colors.0), b = luminance(colors.1)
     precondition((max(a, b) + 0.05) / (min(a, b) + 0.05) >= (preset.preset(dark: dark).foreground == nil ? 4.5 : 3.0), "Theme text contrast regressed")
     precondition(preset.ansiColors(dark: dark).count == 16)
    }
   }
  }
  for name in ["Midnight", "Slate", "Dusk"] {
   var option = TerminalOptionsPreference(); option.theme = name
   let a = luminance(option.colors(dark: true).1), b = luminance(option.palette(dark: true)[8])
   precondition((max(a, b) + 0.05) / (min(a, b) + 0.05) >= 4.5, "Agent user-message background must contrast with default text")
  }
  for (name, foreground, red) in [("Dracula", "F8F8F2", "FF5555"), ("Nord", "D8DEE9", "BF616A"), ("Catppuccin Mocha", "CDD6F4", "F38BA8"), ("Solarized Light", "657B83", "DC322F")] {
   var preset = TerminalOptionsPreference(); preset.selectTheme(name)
   precondition(TerminalOptionsPreference.hex(preset.colors(dark: true).1) == foreground, "Published foreground must match")
   precondition(TerminalOptionsPreference.hex(preset.palette(dark: true)[1]) == red, "Published palette must not be muted by default")
  }
  var custom = TerminalOptionsPreference()
  custom.theme = "Dusk"; custom.customCursor = "EEDDCC"; custom.customSelection = "334455"
  custom.ansiOverrides = ["1": "FF3344"]; custom.coordinateApp = false
  let restored = try JSONDecoder().decode(TerminalOptionsPreference.self, from: JSONEncoder().encode(custom))
  precondition(restored == custom, "Custom colors must survive saving and relaunch")
  precondition(TerminalOptionsPreference.hex(restored.palette(dark: true)[1]) == "FF3344")
  precondition(TerminalOptionsPreference.hex(restored.cursorColors(dark: true).0) == "EEDDCC")
  let oldSaved = preferences.savedThemes
  preferences.value = custom
  preferences.saveTheme(named: "  Smoke custom  ")
  preferences.saveTheme(named: "smoke custom")
  precondition(preferences.savedThemes.filter { $0.name.lowercased() == "smoke custom" }.count == 1)
  precondition(TerminalPreferences().savedThemes.last?.options == custom)
  preferences.savedThemes = oldSaved
  custom.resetColorOverrides()
  precondition(custom.ansiOverrides.isEmpty && custom.customCursor == nil && custom.customSelection == nil)
  preferences.value = TerminalOptionsPreference()
  let rendered = TerminalView(frame: NSRect(x: 0, y: 0, width: 640, height: 280))
  rendered.feed(text: "\u{1b}[31mA\u{1b}[38;2;230;145;175mB\u{1b}[48;2;58;67;80mC")
  let rgbBefore = rendered.getTerminal().getCharData(col: 1, row: 0)!.attribute
  for name in TerminalOptionsPreference.themes {
   var option = TerminalOptionsPreference(); option.theme = name
   option.applyColors(to: rendered, dark: true)
   precondition(rendered.useBrightColors, "Disabling bright colors shifts extended ANSI indices in SwiftTerm")
   precondition(rendered.getTerminal().ansi256PaletteStrategy == .xterm, "Extended agent colors must use standard xterm values")
   precondition(rendered.getTerminal().getCharData(col: 1, row: 0)!.attribute == rgbBefore, "Changing palette must preserve agent RGB")
   precondition(rendered.getTerminal().getCharData(col: 2, row: 0)!.attribute.bg == .trueColor(red: 58, green: 67, blue: 80))
  }
  if ProcessInfo.processInfo.environment["RUNHUDDLE_RENDER_THEMES"] == "1" {
   let folder = URL(fileURLWithPath: "/tmp/runhuddle-theme-previews")
   try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
   for name in TerminalOptionsPreference.themes {
    var option = TerminalOptionsPreference(); option.selectTheme(name)
    preferences.value = option
    let dark = option.preset(dark: true).dark
    let host = NSHostingView(rootView: VStack(alignment: .leading, spacing: 12) {
     HStack { Text("RunHuddle").font(.headline); Spacer(); Text(name).foregroundStyle(HuddleStyle.accent) }.padding(12).background(HuddleStyle.raised)
     TerminalThemePreview(options: option, dark: dark).frame(height: 280)
     Text("Prompt · ANSI palette · dim text · agent RGB").font(.caption).foregroundStyle(.secondary)
    }.padding(16).frame(width: 740, height: 400).background(HuddleStyle.canvas).environment(\.colorScheme, dark ? .dark : .light))
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 740, height: 400), styleMask: .borderless, backing: .buffered, defer: false)
    window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window.contentView = host
    host.layoutSubtreeIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(0.15))
    let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds)!
    host.cacheDisplay(in: host.bounds, to: bitmap)
    // cacheDisplay captures glyphs but not SwiftTerm's CALayer background.
    let image = NSImage(size: host.bounds.size)
    image.lockFocus()
    option.colors(dark: dark).0.setFill(); host.bounds.fill()
    let foreground = NSImage(size: host.bounds.size)
    foreground.addRepresentation(bitmap)
    foreground.draw(in: host.bounds, from: .zero, operation: .sourceOver, fraction: 1)
    image.unlockFocus()
    let composited = NSBitmapImageRep(data: image.tiffRepresentation!)!
    try composited.representation(using: .png, properties: [:])!.write(to: folder.appendingPathComponent(name + ".png"))
   }
   preferences.value = TerminalOptionsPreference()
  }
  precondition(!TerminalOptionsPreference().coordinateApp, "App/terminal colors must default to independent")
  var savedAppearance = TerminalOptionsPreference(); savedAppearance.selectTheme("Dracula"); savedAppearance.coordinateApp = true
  savedAppearance.customForeground = "EEDDCC"
  preferences.value = TerminalOptionsPreference()
  preferences.value.scrollback = 50000; preferences.value.optionAsMeta = true
  preferences.applySavedTheme(savedAppearance)
  precondition(!preferences.value.coordinateApp && preferences.value.theme == "Dracula" && preferences.value.customForeground == "EEDDCC")
  precondition(preferences.value.scrollback == 50000 && preferences.value.optionAsMeta, "Appearance must not change terminal behavior")
  precondition(preferences.value.appColorScheme(appearance: "light") == .light)
  preferences.value.coordinateApp = true
  precondition(preferences.value.appColorScheme(appearance: "light") == .dark)
  UserDefaults.standard.set(false, forKey: "independentAppearanceMigration1")
  let migrated = TerminalPreferences()
  precondition(!migrated.value.coordinateApp && migrated.value.theme == "Dracula", "Migration must unlink without discarding terminal styling")
  migrated.value.coordinateApp = true
  precondition(TerminalPreferences().value.coordinateApp, "A later explicit opt-in must survive relaunch")
  preferences.value = TerminalOptionsPreference()
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("runhuddle pty ' \(UUID().uuidString)")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let session = EmbeddedAgentSession(executable: "/bin/sh", directory: root.path)
  let window = NSWindow(contentRect:NSRect(x:0,y:0,width:900,height:540),styleMask:[.borderless],backing:.buffered,defer:false)
  window.contentView = session.terminal
  func wait(_ label: String = #line.description, _ condition: () -> Bool) {
   let limit = Date().addingTimeInterval(5)
   while !condition() && Date()<limit { RunLoop.main.run(until:Date().addingTimeInterval(0.02)) }
   if !condition() { print("WAIT",label,"OUTPUT:", String(data:session.terminal.getTerminal().getBufferAsData(),encoding:.utf8) ?? "", "cwd",(try? String(contentsOf:root.appendingPathComponent("current-directory"),encoding:.utf8)) ?? "","expected",root.resolvingSymlinksInPath().path,"running",session.terminal.process.running,"dims",session.terminal.getTerminal().cols); fflush(stdout) }; precondition(condition(), "PTY condition timed out")
  }
  func output() -> String { String(data:session.terminal.getTerminal().getBufferAsData(),encoding:.utf8) ?? "" }
  wait("check") { session.terminal.process.running }
  session.terminal.send(txt:"printf 'PTY_OK'; pwd > current-directory; stty size\n")
  let cwdFile = root.appendingPathComponent("current-directory")
  wait("cwd") { URL(fileURLWithPath: (try? String(contentsOf: cwdFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "/").resolvingSymlinksInPath().path == root.resolvingSymlinksInPath().path }
  precondition(output().contains("PTY_OK"))
  let oldCols=session.terminal.getTerminal().cols
  window.setContentSize(NSSize(width:520,height:340));session.terminal.frame = NSRect(x:0,y:0,width:520,height:340);session.terminal.layoutSubtreeIfNeeded()
  wait("resize") { session.terminal.getTerminal().cols < oldCols }
  session.terminal.send(txt:"stty size > dimensions\n")
  let file=root.appendingPathComponent("dimensions")
  wait("stty") { FileManager.default.fileExists(atPath:file.path) && ((try? String(contentsOf:file,encoding:.utf8))?.contains(String(session.terminal.getTerminal().cols)) ?? false) }
  window.contentView = NSView()
  precondition(session.terminal.process.running,"View detachment must not stop process")
  window.contentView=session.terminal
  session.terminal.send(txt:"printf 'AFTER_REATTACH'\n")
  wait("check") { output().contains("AFTER_REATTACH") }
  let preview = NSHostingView(rootView: EmbeddedTerminalContent(session: session).environmentObject(AppModel()))
  window.contentView = preview
  window.setContentSize(NSSize(width:900,height:650))
  preview.frame = NSRect(x:0,y:0,width:900,height:650)
  preview.layoutSubtreeIfNeeded()
  RunLoop.main.run(until:Date().addingTimeInterval(0.2))
  if let bitmap = preview.bitmapImageRepForCachingDisplay(in:preview.bounds) {
   preview.cacheDisplay(in:preview.bounds,to:bitmap)
   try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"/tmp/runhuddle-terminal-prototype.png"))
  }
  let manager = EmbeddedTerminals.shared
  manager.sessions.append(session)
  manager.presentedID = session.id
  manager.close(session)
  precondition(manager.sessions.contains { $0.id == session.id }, "Cannot close a running process")
  let mappingModel = AppModel()
  let greeting = Session(provider:"Codex", sessionID:UUID().uuidString, title:"Respond to greeting", cwd:root.path, state:.idle)
  mappingModel.sessions = [greeting]
  session.title = "Respond to greeting | " + root.lastPathComponent
  precondition(session.row(in:mappingModel)?.id == greeting.id, "Codex without PID routes by unique full title and project")
  mappingModel.sessions.append(Session(provider:"Codex",sessionID:UUID().uuidString,title:greeting.title,cwd:root.path,state:.idle))
  precondition(session.row(in:mappingModel) == nil, "Duplicate titles must not guess")
  mappingModel.sessions = [greeting]
  session.title = "Another session | " + root.lastPathComponent
  precondition(session.row(in:mappingModel) == nil, "Switching conversations invalidates the old match")
  for scheme in [ColorScheme.light, .dark] {
   let themed = NSHostingView(rootView: EmbeddedTerminalHost(session:session).environment(\.colorScheme, scheme))
   window.contentView = themed
   themed.frame = NSRect(x:0,y:0,width:900,height:650)
   themed.layoutSubtreeIfNeeded()
   RunLoop.main.run(until:Date().addingTimeInterval(0.1))
   let white = session.terminal.nativeBackgroundColor.usingColorSpace(.genericGray)!.whiteComponent
   precondition(scheme == .light ? white > 0.9 : white < 0.2, "Terminal follows light/dark appearance")
  }
  preferences.value.size = 18
  preferences.value.scrollback = 1000
  preferences.value.cursor = "steadyBar"
  preferences.value.optionAsMeta = true
  RunLoop.main.run(until:Date().addingTimeInterval(0.2))
  precondition(session.terminal.font.pointSize == 18)
  precondition(session.terminal.getTerminal().options.scrollback == 1000)
  precondition(session.terminal.optionAsMetaKey)
  precondition(session.terminal.getTerminal().options.cursorStyle.tagName == "steadyBar")
  precondition(session.terminal.process.running, "Preferences must not restart the process")
  let paletteBefore = session.appliedPalette![1]
  preferences.value.saturation = 0
  preferences.value.contrast = 0
  preferences.value.customBackground = "29313B"
  RunLoop.main.run(until: Date().addingTimeInterval(0.2))
  let muted = session.appliedPalette![1]
  precondition(muted != paletteBefore && muted.red == muted.green && muted.green == muted.blue, "Palette must update immediately")
  precondition(TerminalOptionsPreference.hex(session.terminal.nativeBackgroundColor) == "29313B")
  precondition(session.terminal.process.running, "Color changes must preserve the running process")
  let encoded = try JSONEncoder().encode(preferences.value)
  let decoded = try JSONDecoder().decode(TerminalOptionsPreference.self, from: encoded)
  precondition(decoded == preferences.value)
  preferences.value = TerminalOptionsPreference()
  for scheme in [ColorScheme.light, .dark] {
   NSApp.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
   let settings = NSHostingView(rootView: EmbeddedTerminalSettings().padding(24).frame(width:520).background(HuddleStyle.panel).environment(\.colorScheme, scheme))
   window.contentView = settings
   window.setContentSize(NSSize(width:520,height:1000))
   settings.frame = NSRect(x:0,y:0,width:520,height:1000)
   settings.layoutSubtreeIfNeeded()
   RunLoop.main.run(until:Date().addingTimeInterval(0.2))
   if let bitmap = settings.bitmapImageRepForCachingDisplay(in:settings.bounds) {
    settings.cacheDisplay(in:settings.bounds,to:bitmap)
    try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"/tmp/runhuddle-terminal-settings-\(scheme == .dark ? "dark" : "light").png"))
   }
  }
  // Exercise the drop/paste path through a real PTY without touching the user's clipboard.
  let board = NSPasteboard.withUniqueName()
  defer { board.releaseGlobally() }
  let terminal = session.terminal as! HuddleTerminalView
  let dropped = root.appendingPathComponent("screen shot ' $(literal).png")
  try Data([1, 2, 3]).write(to: dropped)
  board.writeObjects([dropped as NSURL])
  session.terminal.send(txt:"read -r dropped; printf '%s' \"$dropped\" > dropped-reference\n")
  RunLoop.main.run(until: Date().addingTimeInterval(0.1))
  precondition(terminal.pasteAttachment(from: board, trailingSpace: true))
  RunLoop.main.run(until: Date().addingTimeInterval(0.1))
  let received = root.appendingPathComponent("dropped-reference")
  precondition(!FileManager.default.fileExists(atPath: received.path), "Dropping must not submit input")
  session.terminal.send(txt:"\n")
  wait("dropped reference") { FileManager.default.fileExists(atPath: received.path) }
  let receivedText = try String(contentsOf: received, encoding: .utf8)
  precondition(receivedText == ShellCommand.quote(dropped.path))
  board.clearContents()
  board.writeObjects([root.appendingPathComponent("bad\nname.png") as NSURL])
  precondition(!terminal.pasteAttachment(from: board, trailingSpace: true), "Reject control characters")
  board.clearContents()
  let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  board.setData(bitmap.representation(using: .png, properties: [:])!, forType: .png)
  session.terminal.send(txt:"read -r image; printf '%s' \"$image\" > image-reference\n")
  RunLoop.main.run(until: Date().addingTimeInterval(0.1))
  precondition(terminal.pasteAttachment(from: board, trailingSpace: true))
  session.terminal.send(txt:"\n")
  let imageReference = root.appendingPathComponent("image-reference")
  wait("image reference") { FileManager.default.fileExists(atPath: imageReference.path) }
  let imagePath = String(try String(contentsOf: imageReference, encoding: .utf8).dropFirst().dropLast())
  precondition(NSImage(contentsOfFile: imagePath) != nil, "Dropped image must become a readable image file")
  try FileManager.default.removeItem(atPath: imagePath)
  // Resolve identity before the exit callback marks the terminal ended.
  session.title = "Respond to greeting | " + root.lastPathComponent
  var exitedSessionID: String?
  session.onProcessExit = { terminal in exitedSessionID = terminal.row(in: mappingModel)?.id }
  // Retain output after a normal process exit.
  session.terminal.send(txt:"exit 7\n")
  wait("exit") { session.ended }
  precondition(exitedSessionID == greeting.id, "Process exit must preserve the mapped session for shutdown recovery")
  precondition(!session.terminal.process.running)
  manager.close(session)
  precondition(manager.presentedID == nil && manager.sessions.isEmpty, "Closing removes the exited terminal and returns to sessions")
  let model=AppModel()
  let busy=Session(provider:"Codex",sessionID:UUID().uuidString,title:"Busy",cwd:root.path,state:.working)
  do { _ = try EmbeddedTerminals.shared.start(model:model,directory:root.path,resume:busy);fatalError("Must reject external live session") } catch {}
  let shim = root.appendingPathComponent("agent shim")
  try "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PWD/arguments\"\n".write(to:shim, atomically:true, encoding:.utf8)
  try FileManager.default.setAttributes([.posixPermissions:0o700], ofItemAtPath:shim.path)
  let argsFile = root.appendingPathComponent("arguments")
  for provider in ["Codex", "Claude", "Copilot"] {
   let sid = UUID().uuidString
   let resumed = EmbeddedAgentSession(executable:shim.path,directory:root.path,resume:sid,provider:provider)
   wait("resume arguments") { resumed.ended }
   let args = try String(contentsOf:argsFile,encoding:.utf8)
   precondition(args == (provider == "Codex" ? "resume" : "--resume") + "\n" + sid + "\n")
   let prompt = "Keep 'quotes' and $(literal)"
   let fresh = EmbeddedAgentSession(executable:shim.path,directory:root.path,provider:provider,prompt:prompt)
   wait("prompt arguments") { fresh.ended }
   let freshArgs = try String(contentsOf:argsFile,encoding:.utf8)
   precondition(freshArgs == (provider == "Copilot" ? "-i\n" : "") + prompt + "\n")
  }
  let stubborn = EmbeddedAgentSession(executable:"/bin/sh", directory:root.path)
  stubborn.terminal.send(txt:"trap '' TERM; printf ready > stubborn-ready\n")
  wait("stubborn ready") { FileManager.default.fileExists(atPath:root.appendingPathComponent("stubborn-ready").path) }
  stubborn.stop()
  precondition(stubborn.stopping)
  wait("forced stop") { stubborn.ended && !stubborn.terminal.process.running }
  precondition(!stubborn.stopping)
  // A private persistent server must survive client detach and abrupt client death.
  let service = PersistentTerminalService(folder: URL(fileURLWithPath: "/tmp/rh-persist-" + UUID().uuidString.prefix(8)))
  precondition(service.environment["NO_COLOR"] == nil, "Automation color suppression must not reach interactive terminals")
  // Large review requests must not travel inside tmux's size-limited command message.
  let largePrompt = String(repeating: "Review 'quotes', \"double quotes\", $(touch INJECTED), `literal`, $HOME, Unicode 🐱\n", count: 1400) + "\n\n"
  for provider in ["Codex", "Claude", "Copilot"] {
   try? FileManager.default.removeItem(at: argsFile)
   let record = try service.create(executable: shim.path, directory: root.path, provider: provider, resume: nil, prompt: largePrompt)
   wait("large persistent prompt") { (try? service.pane(record).dead) == true }
   let received = try String(contentsOf: argsFile, encoding: .utf8)
   precondition(received == (provider == "Copilot" ? "-i\n" : "") + largePrompt + "\n", "Large prompt bytes and provider arguments must be preserved")
   precondition(!FileManager.default.fileExists(atPath: root.appendingPathComponent("INJECTED").path), "Prompt must remain literal data")
   precondition(!FileManager.default.fileExists(atPath: service.folder.appendingPathComponent("launch-" + record.id + ".zsh").path), "Prompt launch file must remove itself")
   try service.remove(record)
  }
  do {
   _ = try service.create(executable: shim.path, directory: root.appendingPathComponent("missing-directory").path, provider: "Codex", resume: nil, prompt: largePrompt)
   fatalError("Invalid launch directory must fail")
  } catch {}
  precondition((try? service.records().isEmpty) == true, "Failed launches must not leave tracked sessions")
  precondition((try? FileManager.default.contentsOfDirectory(atPath: service.folder.path).filter { $0.hasPrefix("launch-") }.isEmpty) == true, "Failed launches must remove prompt files")
  let failing = PersistentTerminalService(folder: URL(fileURLWithPath: "/tmp/rh-launch-fail-" + UUID().uuidString.prefix(8)), runtimeExecutable: "/usr/bin/false")
  defer { try? FileManager.default.removeItem(at: failing.folder) }
  do {
   _ = try failing.create(executable: shim.path, directory: root.path, provider: "Codex", resume: nil, prompt: largePrompt)
   fatalError("Failed tmux invocation must fail the launch")
  } catch {}
  precondition((try? failing.records().isEmpty) == true, "Failed tmux launch must roll back the registry")
  precondition((try? FileManager.default.contentsOfDirectory(atPath: failing.folder.path).filter { $0.hasPrefix("launch-") }.isEmpty) == true, "Failed tmux launch must remove private prompt files")
  let durable = try service.create(executable: "/bin/sh", directory: root.path, provider: "Codex", resume: nil, prompt: nil)
  try service.run(["set-environment", "-g", "NO_COLOR", "1"])
  let peer = try service.create(executable: "/bin/sh", directory: root.path, provider: "Claude", resume: nil, prompt: nil)
  defer { try? service.remove(durable); try? service.remove(peer); try? FileManager.default.removeItem(at: service.folder) }
  let first = EmbeddedAgentSession(executable: "", directory: root.path, persistent: durable, service: service)
  window.contentView = first.terminal
  first.terminal.send(txt: "printf 'PERSISTENT_HISTORY'; export RH_REATTACH_TOKEN=still_here\n")
  try service.run(["send-keys", "-t", peer.name, "printf '%s' \"${NO_COLOR-unset}\" > color-environment", "Enter"])
  let colorEnvironment = root.appendingPathComponent("color-environment")
  wait("interactive color environment") { (try? String(contentsOf: colorEnvironment, encoding: .utf8)) == "unset" }
  wait("persistent history") { ((try? service.run(["capture-pane", "-p", "-t", durable.name])) ?? "").contains("PERSISTENT_HISTORY") }
  let originalPID = try service.pane(durable).pid
  first.detach()
  wait("detached client") { !first.terminal.process.running }
  precondition((try? service.pane(durable).pid) == originalPID)
  let stored = try service.records().first { $0.id == durable.id }!
  let second = EmbeddedAgentSession(executable: "", directory: root.path, persistent: stored, service: service)
  window.contentView = second.terminal
  second.terminal.send(txt: "printf '%s' \"$RH_REATTACH_TOKEN\" > reattached-token\n")
  let token = root.appendingPathComponent("reattached-token")
  wait("same shell environment") { (try? String(contentsOf: token, encoding: .utf8)) == "still_here" }
  precondition((try? service.pane(durable).pid) == originalPID)
  let history = try service.run(["capture-pane", "-p", "-S", "-", "-t", durable.name])
  precondition(history.contains("PERSISTENT_HISTORY"), "Server retains terminal history across reattachment")
  let crashedClientPID = second.terminal.process.shellPid
  kill(crashedClientPID, SIGKILL)
  wait("client crash recovery") { second.terminal.process.running && second.terminal.process.shellPid != crashedClientPID && second.pid == originalPID }
  precondition((try? service.pane(durable).pid) == originalPID)
  second.stop()
  wait("persistent stop") { second.ended }
  precondition((try? service.pane(peer).dead) == false, "Stopping one terminal must not stop another")
  second.detach()
  second.resumedID = "ended-test"
  EmbeddedTerminals.shared.sessions = [second]
  EmbeddedTerminals.shared.closeEndedAgents(sessionIDs: ["Codex:other"])
  precondition(EmbeddedTerminals.shared.sessions.count == 1)
  EmbeddedTerminals.shared.closeEndedAgents(sessionIDs: ["Codex:ended-test"])
  precondition(EmbeddedTerminals.shared.sessions.isEmpty)
  precondition((try? service.records().contains { $0.id == durable.id }) == false)
  precondition((try? service.pane(peer).dead) == false)
  // Plain shells retain identity, environment and cwd across client reattachment.
  let shellRecord = try service.create(executable: "/bin/sh", directory: root.path, provider: "Shell", resume: nil, prompt: nil)
  defer { try? service.remove(shellRecord) }
  let shell = EmbeddedAgentSession(executable: "", directory: root.path, provider: "Shell", persistent: shellRecord, service: service)
  precondition(shell.isShell && shell.row(in: model) == nil)
  try shell.renameShell("Build terminal")
  try service.run(["send-keys", "-t", shellRecord.name, #"export RH_SHELL_TOKEN=retained; pwd > shell-cwd; printf '\033]0;Codex fake title\007'"#, "Enter"])
  wait("shell command cwd") { FileManager.default.fileExists(atPath: root.appendingPathComponent("shell-cwd").path) }
  let shellCWD = try String(contentsOf: root.appendingPathComponent("shell-cwd"), encoding: .utf8).trimmingCharacters(in: .newlines)
  precondition(shellCWD == root.path)
  let activity = try service.shellActivity(shellRecord)
  precondition(URL(fileURLWithPath: activity.directory).resolvingSymlinksInPath() == root.resolvingSymlinksInPath() && !activity.command.isEmpty && activity.tty.hasPrefix("/dev/"), "Live tmux fields must survive display-message escaping")
  precondition(activity.title == "Codex fake title", "Read the emitted PTY title, not the saved shell name")
  let shellPID = try service.pane(shellRecord).pid
  shell.detach()
  let renamed = try service.records().first { $0.id == shellRecord.id }!
  precondition(renamed.title == "Build terminal" && renamed.provider == "Shell" && renamed.sessionID == nil)
  let restoredShell = EmbeddedAgentSession(executable: "", directory: root.path, provider: "Shell", persistent: renamed, service: service)
  try service.run(["send-keys", "-t", shellRecord.name, "printf '%s' \"$RH_SHELL_TOKEN\" > shell-token; /bin/sleep 120 & echo $! > shell-child; wait", "Enter"])
  wait("restored shell environment") { (try? String(contentsOf: root.appendingPathComponent("shell-token"), encoding: .utf8)) == "retained" }
  precondition((try? service.pane(shellRecord).pid) == shellPID)
  precondition(restoredShell.title == "Build terminal" && restoredShell.row(in: model) == nil)
  let child = Int32(try String(contentsOf: root.appendingPathComponent("shell-child"), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines))!
  restoredShell.stop()
  wait("shell shutdown") { restoredShell.ended }
  // Normal jobs attached to this shell receive hangup; peers are untouched.
  wait("shell job shutdown") { kill(child, 0) != 0 }
  precondition((try? service.pane(peer).dead) == false)
  restoredShell.detach()
  let neighborRecord = try service.create(executable: "/bin/sh", directory: root.path, provider: "Shell", resume: nil, prompt: nil)
  let neighbor = EmbeddedAgentSession(executable: "", directory: root.path, provider: "Shell", persistent: neighborRecord, service: service)
  defer { try? service.remove(neighborRecord) }
  EmbeddedTerminals.shared.sessions = [restoredShell, neighbor]
  EmbeddedTerminals.shared.presentedID = restoredShell.id
  EmbeddedTerminals.shared.close(neighbor)
  precondition(EmbeddedTerminals.shared.sessions.count == 2, "A running tab cannot be discarded without stopping it")
  EmbeddedTerminals.shared.close(restoredShell)
  precondition(EmbeddedTerminals.shared.presentedID == neighbor.id && !neighbor.ended)
  neighbor.stop()
  EmbeddedTerminals.shared.close(neighbor)
  precondition(EmbeddedTerminals.shared.presentedID == EmbeddedTerminals.shellWorkspaceID)
  precondition(EmbeddedTerminals.shared.sessions.isEmpty)
  print("Embedded PTY: input/output, quoted cwd, resize, view detach/reattach, exit, and external-session guard passed.")
 }
}
