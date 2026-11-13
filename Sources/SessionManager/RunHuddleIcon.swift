import AppKit

/// Stacked terminal panes shared by the app tile and macOS template menu-bar icon.
enum RunHuddleIcon {
    /// A non-template badge preserves its amber fill in the macOS menu bar.
    /// The terminal mark remains a separate template image so it follows system appearance.
    static func attentionBadge(count: Int) -> NSImage? {
        guard count > 0 else { return nil }
        let label = count > 99 ? "99+" : String(count)
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .bold),
            .foregroundColor: NSColor.black
        ]
        let text = NSAttributedString(string: label, attributes: attributes)
        let textSize = text.size()
        let size = NSSize(width: max(18, ceil(textSize.width) + 8), height: 16)
        let image = NSImage(size: size, flipped: false) { rect in
            NSColor(calibratedRed: 1, green: 0.72, blue: 0.24, alpha: 1).setFill()
            NSBezierPath(roundedRect: rect, xRadius: 8, yRadius: 8).fill()
            text.draw(at: NSPoint(x: (rect.width - textSize.width) / 2,
                                  y: (rect.height - textSize.height) / 2))
            return true
        }
        image.isTemplate = false
        image.accessibilityDescription = "\(count) sessions need input"
        return image
    }

    static func image(size: CGFloat = 18, appTile: Bool = false) -> NSImage {
        let width = size
        let image = NSImage(size: NSSize(width: width, height: size), flipped: false) { rect in
            if appTile {
                let tile = NSBezierPath(roundedRect: rect.insetBy(dx: size * 0.04, dy: size * 0.04),
                                        xRadius: size * 0.21, yRadius: size * 0.21)
                NSGradient(starting: NSColor(srgbRed: 0.067, green: 0.11, blue: 0.176, alpha: 1),
                           ending: NSColor(srgbRed: 0.035, green: 0.063, blue: 0.10, alpha: 1))!
                    .draw(in: tile, angle: -70)
            }
            NSGraphicsContext.saveGraphicsState()
            defer { NSGraphicsContext.restoreGraphicsState() }
            let scale = appTile ? size * 0.80 / 24 : size / 24
            let transform = NSAffineTransform()
            transform.translateX(by: (width - 24 * scale) / 2, yBy: (size - 24 * scale) / 2)
            transform.scale(by: scale)
            transform.concat()
            // Three offset terminal panes; partial rear outlines stay clear at menu-bar sizes.
            func stroke(_ points: [(CGFloat, CGFloat)], color: NSColor, width: CGFloat = 1.6) {
                let path = NSBezierPath()
                path.move(to: NSPoint(x: points[0].0, y: points[0].1))
                for point in points.dropFirst() { path.line(to: NSPoint(x: point.0, y: point.1)) }
                path.lineWidth = width
                path.lineJoinStyle = .round
                path.lineCapStyle = .round
                color.setStroke(); path.stroke()
            }
            let cyan = appTile ? NSColor(srgbRed: 0.14, green: 0.78, blue: 0.90, alpha: 1) : .black
            let middle = appTile ? NSColor(srgbRed: 0.08, green: 0.62, blue: 0.83, alpha: 1) : .black
            let back = appTile ? NSColor(srgbRed: 0.03, green: 0.43, blue: 0.68, alpha: 1) : .black
            stroke([(5, 10), (2.5, 10), (2.5, 21), (16.5, 21), (16.5, 17.5)], color: back)
            stroke([(8, 6.5), (5.5, 6.5), (5.5, 17.5), (19.5, 17.5), (19.5, 14)], color: middle)
            let front = NSBezierPath(roundedRect: NSRect(x: 8.5, y: 3, width: 14, height: 11), xRadius: 0.8, yRadius: 0.8)
            front.lineWidth = 1.6
            cyan.setStroke(); front.stroke()
            stroke([(11.5, 10.5), (14, 8.5), (11.5, 6.5)], color: cyan)
            stroke([(16, 6.5), (19, 6.5)], color: cyan)
            return true
        }
        image.isTemplate = !appTile
        image.accessibilityDescription = "RunHuddle"
        return image
    }
}
