import AppKit
import SwiftUI

// Follow intent belongs to the reader, not to a geometry measurement. Content
// growth must never be mistaken for the user scrolling away from the bottom.
struct ConversationScrollFollower: NSViewRepresentable {
    @Binding var following: Bool
    let sessionID: String
    let jump: Int
    func makeNSView(context: Context) -> ConversationFollowView { ConversationFollowView() }
    func updateNSView(_ view: ConversationFollowView, context: Context) {
        view.changed = { value in if following != value { following = value } }
        if view.sessionID != sessionID || view.jump != jump {
            view.sessionID = sessionID; view.jump = jump
            view.setFollowing(true)
        }
        view.attach()
        view.scheduleFollow()
    }
    static func dismantleNSView(_ view: ConversationFollowView, coordinator: ()) { view.detach() }
}

final class ConversationFollowView: NSView {
    var changed: ((Bool) -> Void)?
    var sessionID = ""
    var jump = 0
    private(set) var following = true
    private weak var scroll: NSScrollView?
    private var observations: [NSObjectProtocol] = []
    private var monitor: Any?
    private var scheduled = false
    private var readerReturningToLatest = false
    override func viewDidMoveToSuperview() {
        super.viewDidMoveToSuperview()
        DispatchQueue.main.async { [weak self] in self?.attach() }
    }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window == nil { detach() }
        else { DispatchQueue.main.async { [weak self] in self?.attach() } }
    }
    func attach() {
        guard let candidate = enclosingScrollView, candidate !== scroll else { return }
        detach(); scroll = candidate
        candidate.contentView.postsBoundsChangedNotifications = true
        candidate.contentView.postsFrameChangedNotifications = true
        candidate.postsFrameChangedNotifications = true
        candidate.documentView?.postsFrameChangedNotifications = true
        let center = NotificationCenter.default
        for view in [candidate, candidate.contentView] {
            observations.append(center.addObserver(forName: NSView.frameDidChangeNotification, object: view, queue: .main) { [weak self] _ in self?.scheduleFollow() })
        }
        observations.append(center.addObserver(forName: NSView.frameDidChangeNotification, object: candidate.documentView, queue: .main) { [weak self] _ in self?.scheduleFollow() })
        observations.append(center.addObserver(forName: NSView.boundsDidChangeNotification, object: candidate.contentView, queue: .main) { [weak self] _ in
            guard let self else { return }
            if self.following { self.scheduleFollow() }
            else { self.scheduleReaderPositionCheck() }
        })
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .leftMouseDown, .keyDown]) { [weak self] event in
            guard let self, let scroll = self.scroll, event.window === scroll.window else { return event }
            let point = scroll.convert(event.locationInWindow, from: nil)
            if event.type == .scrollWheel, scroll.bounds.contains(point) {
                // Positive vertical deltas move toward older messages in the
                // flipped transcript. Even a sub-point gesture cancels follow.
                if event.scrollingDeltaY != 0 {
                    let flipped = scroll.documentView?.isFlipped ?? true
                    self.readerWillScroll(towardLatest: flipped ? event.scrollingDeltaY < 0 : event.scrollingDeltaY > 0)
                }
            } else if event.type == .leftMouseDown, let scroller = scroll.verticalScroller,
                      scroller.bounds.contains(scroller.convert(event.locationInWindow, from: nil)) {
                self.readerWillScroll(towardLatest: true)
            } else if event.type == .keyDown, [UInt16(115), 116, 119, 121, 125, 126].contains(event.keyCode),
                      let responder = scroll.window?.firstResponder as? NSView,
                      responder === scroll || responder.isDescendant(of: scroll) {
                self.readerWillScroll(towardLatest: [UInt16(119), 121, 125].contains(event.keyCode))
            }
            return event
        }
        scheduleFollow()
    }
    func detach() {
        observations.forEach(NotificationCenter.default.removeObserver)
        observations.removeAll()
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil; scroll = nil
    }
    func setFollowing(_ value: Bool) {
        following = value
        DispatchQueue.main.async { [weak self] in
            guard let self, self.following == value else { return }
            self.changed?(value)
        }
        if value { scheduleFollow() }
    }
    func readerWillScroll(towardLatest: Bool = false) {
        readerReturningToLatest = towardLatest
        setFollowing(false)
        scheduleReaderPositionCheck()
    }
    private func scheduleReaderPositionCheck() {
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.following, self.readerReturningToLatest, let scroll = self.scroll, let document = scroll.documentView else { return }
            let clip = scroll.contentView.bounds
            let distance = document.isFlipped ? document.bounds.maxY - clip.maxY : clip.minY - document.bounds.minY
            if distance <= 1 { self.setFollowing(true) }
        }
    }
    func scheduleFollow() {
        guard following, !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.scheduled = false
            guard self.following, let scroll = self.scroll, let document = scroll.documentView else { return }
            // Run after SwiftUI has sized the updated transcript, including image
            // previews and changes to the space occupied by the composer.
            scroll.layoutSubtreeIfNeeded()
            document.layoutSubtreeIfNeeded()
            let clip = scroll.contentView
            let y = document.isFlipped ? max(document.bounds.minY, document.bounds.maxY - clip.bounds.height) : document.bounds.minY
            if abs(clip.bounds.minY - y) > 0.5 {
                clip.scroll(to: NSPoint(x: clip.bounds.minX, y: y))
                scroll.reflectScrolledClipView(clip)
            }
        }
    }
}
