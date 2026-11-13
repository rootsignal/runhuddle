import AppKit

/// One compact huddle silhouette shared by the app tile and macOS template menu-bar icon.
enum RunHuddleIcon {
    /// A non-template badge preserves its amber fill in the macOS menu bar.
    /// The huddle mark remains a separate template image so it follows system appearance.
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
            // A3: three rounded blocks gather around a shared, open center.
            // Draw the same vector geometry at every Dock and menu-bar size.
            func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x, y: y) }
            let mark = NSBezierPath()
            mark.move(to: point(8.6, 21.3))
            mark.line(to: point(15.4, 21.3))
            mark.curve(to: point(17.2, 20), controlPoint1: point(16.2, 21.3), controlPoint2: point(16.8, 20.9))
            mark.line(to: point(18.3, 17.6))
            mark.curve(to: point(16.5, 15.3), controlPoint1: point(19, 16.1), controlPoint2: point(18.2, 15.3))
            mark.line(to: point(7.5, 15.3))
            mark.curve(to: point(5.7, 17.6), controlPoint1: point(5.8, 15.3), controlPoint2: point(5, 16.1))
            mark.line(to: point(6.8, 20))
            mark.curve(to: point(8.6, 21.3), controlPoint1: point(7.2, 20.9), controlPoint2: point(7.8, 21.3))
            mark.close()
            for mirrored in [false, true] {
                func side(_ x: CGFloat, _ y: CGFloat) -> NSPoint { point(mirrored ? 24 - x : x, y) }
                mark.move(to: side(5, 14.6))
                mark.curve(to: side(6.3, 14.1), controlPoint1: side(5.4, 14.6), controlPoint2: side(5.9, 14.4))
                mark.line(to: side(9.8, 11.4))
                mark.curve(to: side(11.1, 9.2), controlPoint1: side(10.7, 10.7), controlPoint2: side(11.1, 10.1))
                mark.line(to: side(11.1, 5.5))
                mark.curve(to: side(9.5, 3.6), controlPoint1: side(11.1, 4.2), controlPoint2: side(10.6, 3.6))
                mark.line(to: side(6, 3.6))
                mark.curve(to: side(2.5, 7.2), controlPoint1: side(3.8, 3.6), controlPoint2: side(2.5, 4.9))
                mark.line(to: side(2.5, 10.5))
                mark.curve(to: side(5, 14.6), controlPoint1: side(2.5, 12.9), controlPoint2: side(3.7, 14.6))
                mark.close()
            }
            (appTile ? NSColor(srgbRed: 0.14, green: 0.78, blue: 0.90, alpha: 1) : .black).setFill()
            mark.fill()
            return true
        }
        image.isTemplate = !appTile
        image.accessibilityDescription = "RunHuddle"
        return image
    }
}
