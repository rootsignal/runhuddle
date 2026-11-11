import AppKit
import SwiftUI

final class FlippedDocument: NSView { override var isFlipped: Bool { true } }
@MainActor final class TranscriptFixture: ObservableObject {
 @Published var text = String(repeating: "A line in the conversation.\n", count: 40)
}
struct TranscriptView: View {
 @ObservedObject var fixture: TranscriptFixture
 var body: some View {
  ScrollView {
   VStack {
    Text(fixture.text).frame(maxWidth: .infinity, alignment: .leading)
    ConversationScrollFollower(following: .constant(true), sessionID: "fixture", jump: 0).frame(height: 1)
   }
  }.frame(width: 320, height: 200)
 }
}
@main struct ScrollCheck {
 @MainActor static func main() {
  _ = NSApplication.shared
  let scroll = NSScrollView(frame:NSRect(x:0,y:0,width:400,height:300))
  let document = FlippedDocument(frame:NSRect(x:0,y:0,width:400,height:800))
  scroll.documentView = document
  let follower = ConversationFollowView(frame:NSRect(x:0,y:799,width:1,height:1))
  document.addSubview(follower)
  follower.attach()
  func settle() { RunLoop.main.run(until:Date().addingTimeInterval(0.05)) }
  func bottom() -> Bool { abs(scroll.contentView.bounds.maxY - document.bounds.maxY) < 1 }
  settle(); precondition(bottom(), "Initial attachment must follow latest")
  document.setFrameSize(NSSize(width:400,height:1300))
  settle(); precondition(bottom() && follower.following, "Response growth must not disable following")
  // A queued follow must not win against tiny upward gestures near the bottom.
  for _ in 0..<8 {
   follower.scheduleFollow()
   follower.readerWillScroll()
   let y = scroll.contentView.bounds.minY - 0.5
   scroll.contentView.scroll(to:NSPoint(x:0,y:y))
   settle()
   precondition(!follower.following && abs(scroll.contentView.bounds.minY-y)<0.1, "Slow upward scrolling must not snap back within the bottom threshold")
  }
  follower.readerWillScroll()
  scroll.contentView.scroll(to:NSPoint(x:0,y:250))
  settle(); precondition(!follower.following, "Reader scrolling up must pause follow")
  let held = scroll.contentView.bounds.minY
  document.setFrameSize(NSSize(width:400,height:1700))
  settle(); precondition(!follower.following && abs(scroll.contentView.bounds.minY-held)<1, "New content must preserve the reader's position")
  follower.setFollowing(true)
  settle(); precondition(bottom(), "Latest must restore following")
  scroll.setFrameSize(NSSize(width:400,height:180))
  settle(); precondition(bottom(), "Composer growth must retain bottom anchoring")
  follower.readerWillScroll()
  scroll.contentView.scroll(to:NSPoint(x:0,y:500))
  settle(); precondition(!follower.following)
  follower.readerWillScroll(towardLatest: true)
  scroll.contentView.scroll(to:NSPoint(x:0,y:document.bounds.maxY-scroll.contentView.bounds.height))
  settle(); precondition(follower.following, "Scrolling back down must resume following")
  follower.detach()
  let fixture = TranscriptFixture()
  let host = NSHostingView(rootView: TranscriptView(fixture: fixture))
  let window = NSWindow(contentRect:NSRect(x:0,y:0,width:320,height:200),styleMask:[.borderless],backing:.buffered,defer:false)
  window.contentView = host
  host.frame = NSRect(x:0,y:0,width:320,height:200)
  host.layoutSubtreeIfNeeded(); settle()
  func followers(_ view: NSView) -> [ConversationFollowView] {
   (view as? ConversationFollowView).map { [$0] } ?? view.subviews.flatMap(followers)
  }
  guard let hostedFollower = followers(host).first, let hostedScroll = hostedFollower.enclosingScrollView,
        let hostedDocument = hostedScroll.documentView else { fatalError("SwiftUI scroll attachment missing") }
  func hostedBottom() -> Bool { abs(hostedScroll.contentView.bounds.maxY-hostedDocument.bounds.maxY)<2 }
  settle(); precondition(hostedBottom(), "Real SwiftUI initial transcript must follow")
  fixture.text += String(repeating:"New response text arriving.\n",count:30)
  settle(); settle(); precondition(hostedBottom(), "Real SwiftUI response growth must follow after layout")
  hostedFollower.readerWillScroll()
  hostedScroll.contentView.scroll(to:NSPoint(x:0,y:100))
  settle()
  fixture.text += String(repeating:"Another response.\n",count:20)
  settle(); settle()
  precondition(!hostedFollower.following && abs(hostedScroll.contentView.bounds.minY-100)<2, "SwiftUI growth must preserve reading position")
  hostedFollower.detach()
  print("Conversation scrolling: growth, reading position, Latest, viewport resize, and return to bottom passed.")
 }
}
