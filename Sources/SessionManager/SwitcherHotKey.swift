import AppKit
import SwiftUI
import Carbon
import SessionCore

@MainActor final class SwitcherHotKey: ObservableObject {
    @Published private(set) var shortcut: SwitcherShortcut
    @Published private(set) var enabled: Bool
    @Published private(set) var error: String?
    var action: (() -> Void)?
    private var handler: EventHandlerRef?
    private var reference: EventHotKeyRef?
    private var nextID: UInt32 = 1
    init() {
        let saved = UserDefaults.standard.data(forKey: "switcherShortcut").flatMap { try? JSONDecoder().decode(SwitcherShortcut.self, from: $0) }
        shortcut = saved?.valid == true ? saved! : .standard
        enabled = UserDefaults.standard.object(forKey: "switcherShortcutEnabled") as? Bool ?? true
    }
    func start() {
        guard handler == nil else { return }
        var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let result = InstallEventHandler(GetApplicationEventTarget(), { _, event, pointer in
            guard let event, let pointer else { return OSStatus(eventNotHandledErr) }
            var identifier = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil,
                              MemoryLayout<EventHotKeyID>.size, nil, &identifier)
            guard identifier.signature == 0x52484F57 else { return OSStatus(eventNotHandledErr) }
            let owner = Unmanaged<SwitcherHotKey>.fromOpaque(pointer).takeUnretainedValue()
            MainActor.assumeIsolated { owner.action?() }
            return noErr
        }, 1, &event, Unmanaged.passUnretained(self).toOpaque(), &handler)
        guard result == noErr else { error = "Could not register the shortcut handler (\(result))."; return }
        if enabled { register(shortcut) }
    }
    @discardableResult private func register(_ proposed: SwitcherShortcut) -> Bool {
        var candidate: EventHotKeyRef?
        let identifier = EventHotKeyID(signature: 0x52484F57, id: nextID)
        nextID &+= 1
        let result = RegisterEventHotKey(proposed.keyCode, proposed.modifiers, identifier, GetApplicationEventTarget(), 0, &candidate)
        guard result == noErr else {
            error = "Could not use \(proposed.label). It may be used by another app or macOS. Choose another shortcut."
            return false
        }
        if let reference { UnregisterEventHotKey(reference) }
        reference = candidate; error = nil
        return true
    }
    func setShortcut(_ proposed: SwitcherShortcut) {
        guard proposed.valid else { error = "Include Command, Control, or Option with a key."; return }
        if proposed == shortcut { error = nil; return }
        if enabled && !register(proposed) { return }
        shortcut = proposed
        UserDefaults.standard.set(try? JSONEncoder().encode(proposed), forKey: "switcherShortcut")
        error = nil
    }
    func setEnabled(_ value: Bool) {
        if value && reference == nil && !register(shortcut) { return }
        if !value, let reference { UnregisterEventHotKey(reference); self.reference = nil }
        enabled = value; error = nil
        UserDefaults.standard.set(value, forKey: "switcherShortcutEnabled")
    }
    deinit {
        if let reference { UnregisterEventHotKey(reference) }
        if let handler { RemoveEventHandler(handler) }
    }
}

struct ShortcutRecorder: NSViewRepresentable {
    let shortcut: SwitcherShortcut
    let commit: (SwitcherShortcut) -> Void
    func makeNSView(context: Context) -> RecorderButton {
        let button = RecorderButton(); button.bezelStyle = .rounded
        button.target = button; button.action = #selector(RecorderButton.begin)
        button.setAccessibilityLabel("Record session switcher shortcut")
        return button
    }
    func updateNSView(_ button: RecorderButton, context: Context) {
        button.current = shortcut.label; button.commit = commit
        if !button.recording { button.title = shortcut.label }
    }
    final class RecorderButton: NSButton {
        var current = ""; var recording = false
        var commit: ((SwitcherShortcut) -> Void)?
        override var acceptsFirstResponder: Bool { true }
        @objc func begin() { recording = true; title = "Press shortcut…"; window?.makeFirstResponder(self) }
        override func resignFirstResponder() -> Bool { recording = false; title = current; return super.resignFirstResponder() }
        override func performKeyEquivalent(with event: NSEvent) -> Bool {
            guard recording else { return super.performKeyEquivalent(with: event) }
            keyDown(with: event); return true
        }
        override func keyDown(with event: NSEvent) {
            guard recording else { super.keyDown(with: event); return }
            if event.keyCode == 53 { recording = false; title = current; return }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            var mask: UInt32 = 0; var label = ""
            for (flag, bit, symbol) in [(NSEvent.ModifierFlags.control, UInt32(controlKey), "⌃"), (.option, UInt32(optionKey), "⌥"), (.shift, UInt32(shiftKey), "⇧"), (.command, UInt32(cmdKey), "⌘")] {
                if flags.contains(flag) { mask |= bit; label += symbol }
            }
            let key: String
            switch event.keyCode {
            case 49: key = "Space"
            case 36: key = "Return"
            case 48: key = "Tab"
            case 51: key = "Delete"
            case 123: key = "←"
            case 124: key = "→"
            case 125: key = "↓"
            case 126: key = "↑"
            default: key = event.charactersIgnoringModifiers?.uppercased() ?? ""
            }
            guard !key.isEmpty else { return }
            recording = false; title = current
            commit?(SwitcherShortcut(keyCode: UInt32(event.keyCode), modifiers: mask, label: label + key))
        }
    }
}
