import AppKit
@main struct Check {
 @MainActor static func main() {
  _ = NSApplication.shared
  let editor = ReplyInputTextView(frame:NSRect(x:0,y:0,width:300,height:100))
  editor.isRichText = false; editor.isEditable = true
  var sends = 0
  editor.sendMessage = { sends += 1 }
  func key(_ flags:NSEvent.ModifierFlags = [], repeatKey:Bool = false, code:UInt16 = 36) -> NSEvent {
   NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:flags,timestamp:0,windowNumber:0,context:nil,characters:"\r",charactersIgnoringModifiers:"\r",isARepeat:repeatKey,keyCode:code)!
  }
  editor.string = "Draft"; editor.setSelectedRange(NSRange(location:5,length:0))
  editor.keyDown(with:key()); assert(sends == 1 && editor.string == "Draft")
  editor.keyDown(with:key(.shift)); assert(sends == 1 && editor.string == "Draft\n")
  editor.keyDown(with:key(.command)); assert(sends == 2)
  editor.keyDown(with:key(repeatKey:true)); assert(sends == 2)
  editor.keyDown(with:key(code:76)); assert(sends == 3)
  editor.isEditable = false; editor.keyDown(with:key()); assert(sends == 3)
  editor.isEditable = true
  editor.setMarkedText("draft",selectedRange:NSRange(location:5,length:0),replacementRange:NSRange(location:0,length:editor.string.utf16.count))
  assert(editor.hasMarkedText())
  editor.keyDown(with:key()); assert(sends == 3)
  editor.unmarkText()
  let board = NSPasteboard(name: NSPasteboard.Name("RunHuddle-test-" + UUID().uuidString))
  defer { board.releaseGlobally() }
  var paths: [String] = []
  editor.imagePathsPasted = { paths = $0 }
  board.setString("/tmp/Screenshot with spaces.png", forType: .string)
  assert(editor.pasteImageReferences(from: board))
  assert(paths == ["/tmp/Screenshot with spaces.png"])
  board.clearContents()
  board.writeObjects([NSURL(fileURLWithPath:"/tmp/one.png"), NSURL(fileURLWithPath:"/tmp/two.jpg")])
  assert(editor.pasteImageReferences(from: board))
  assert(paths == ["/tmp/one.png", "/tmp/two.jpg"])
  board.clearContents(); board.setString("Ordinary text", forType:.string)
  assert(!editor.pasteImageReferences(from:board))
  editor.string = "Before After"; editor.setSelectedRange(NSRange(location:7,length:0))
  paths = []
  editor.insertText("/tmp/Direct pasted image.png", replacementRange:editor.selectedRange())
  assert(paths == ["/tmp/Direct pasted image.png"], "Direct insertion must create an image preview before sending")
  assert(editor.string == "Before After", "Image path must not remain in the input")
  editor.string = ""; editor.setSelectedRange(NSRange(location:0,length:0))
  editor.insertText("/tmp/Another screenshot.png Please review this", replacementRange:editor.selectedRange())
  assert(paths == ["/tmp/Another screenshot.png"])
  assert(editor.string == "Please review this")
  board.clearContents(); board.setString("/tmp/Dropped screenshot.png", forType:.string)
  paths = []
  assert(editor.readSelection(from:board, type:.string))
  assert(paths == ["/tmp/Dropped screenshot.png"])
  print("Passed direct image insertion and mixed image/text before send.")
  print("Passed local image file/path paste and plain-text fallback.")
  print("Passed: Return, Shift-Return, Command-Return, repeat, keypad, disabled input, IME composition.")
 }
}
