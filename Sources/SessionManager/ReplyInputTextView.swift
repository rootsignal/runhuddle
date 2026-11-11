import AppKit
import SessionCore

/// Chat-style input without treating IME confirmation or held keys as a send.
class ReplyInputTextView: NSTextView {
    var imagePathsPasted: (([String]) -> Void)?
    var imageRejected: (() -> Void)?
    var sendMessage: (() -> Void)?

    override func keyDown(with event: NSEvent) {
        let modifiers = event.modifierFlags.intersection([.shift, .command, .control, .option])
        if (event.keyCode == 36 || event.keyCode == 76), !hasMarkedText() {
            if modifiers.isEmpty || modifiers == .command {
                if isEditable && !event.isARepeat { sendMessage?() }
                return
            }
            if modifiers == .shift {
                if isEditable { insertNewline(nil) }
                return
            }
        }
        super.keyDown(with: event)
    }

    // File paths can arrive through plain-text paste, drag/drop, or direct text
    // insertion, not just the standard Paste action.
    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        let text = (insertString as? String) ?? (insertString as? NSAttributedString)?.string
        if isEditable, !hasMarkedText(), let text, text.count > 1,
           let remaining = extractImageReferences(text) {
            super.insertText(remaining, replacementRange: replacementRange)
            return
        }
        super.insertText(insertString, replacementRange: replacementRange)
    }

    override func pasteAsPlainText(_ sender: Any?) {
        if pasteImageReferences(from: .general) { return }
        super.pasteAsPlainText(sender)
    }

    override func readSelection(from pboard: NSPasteboard, type: NSPasteboard.PasteboardType) -> Bool {
        if pasteImageReferences(from: pboard) { return true }
        return super.readSelection(from: pboard, type: type)
    }

    private func extractImageReferences(_ text: String) -> String? {
        guard let imagePathsPasted else { return nil }
        let references = LocalImageReference.extract(from: text)
        guard !references.isEmpty else { return nil }
        imagePathsPasted(references.map(\.path))
        return references.reduce(text) { $0.replacingOccurrences(of: $1.source, with: "") }
            .trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'")))
    }

    override func paste(_ sender: Any?) {
        if pasteImageReferences(from: .general) { return }
        super.pasteAsPlainText(sender)
    }

    @discardableResult
    func pasteImageReferences(from board: NSPasteboard) -> Bool {
        guard isEditable else { return true }
        let urls = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        if !urls.isEmpty && urls.allSatisfy({ LocalImageReference.extensions.contains($0.pathExtension.lowercased()) }), let imagePathsPasted {
            imagePathsPasted(urls.map(\.path)); return true
        }
        if let text = board.string(forType: .string), let remaining = extractImageReferences(text) {
            super.insertText(remaining, replacementRange: selectedRange())
            return true
        }
        if board.canReadObject(forClasses: [NSImage.self], options: nil) {
            imageRejected?()
            return true
        }
        return false
    }
}
