import AppKit

/// One Lookout owl silhouette shared by the app tile and macOS template menu-bar icon.
enum RunHuddleIcon {
    /// A non-template badge preserves its amber fill in the macOS menu bar.
    /// The owl remains a separate template image so it follows system appearance.
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
                NSGradient(starting: NSColor(calibratedRed: 0.09, green: 0.14, blue: 0.25, alpha: 1),
                           ending: NSColor(calibratedRed: 0.025, green: 0.045, blue: 0.09, alpha: 1))!
                    .draw(in: tile, angle: -70)
            }
            NSGraphicsContext.saveGraphicsState()
            defer { NSGraphicsContext.restoreGraphicsState() }
            let scale = appTile ? size * 0.72 / 24 : size / 24
            let transform = NSAffineTransform()
            transform.translateX(by: (width - 24 * scale) / 2, yBy: (size - 24 * scale) / 2)
            transform.scale(by: scale)
            transform.concat()
            // Rounded ear tips and open eyes keep the owl watchful rather than
            // scowling. No separate brow or tiny details to disappear at 18 pt.
            func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
                NSPoint(x: x, y: y)
            }
            let mark = NSBezierPath()
            mark.windingRule = .evenOdd
            mark.move(to: point(3, 15.5))
            mark.curve(to: point(3, 21), controlPoint1: point(2.2, 18), controlPoint2: point(2, 22))
            mark.curve(to: point(7.2, 18.4), controlPoint1: point(3.6, 21), controlPoint2: point(5.9, 19.4))
            mark.curve(to: point(16.8, 18.4), controlPoint1: point(10, 19.2), controlPoint2: point(14, 19.2))
            mark.curve(to: point(21, 21), controlPoint1: point(18.1, 19.4), controlPoint2: point(20.4, 21))
            mark.curve(to: point(21, 15.5), controlPoint1: point(22, 22), controlPoint2: point(21.8, 18))
            mark.curve(to: point(22.5, 10.5), controlPoint1: point(22, 14), controlPoint2: point(22.5, 12.5))
            mark.curve(to: point(16, 4.4), controlPoint1: point(22.5, 6.3), controlPoint2: point(19.6, 4.8))
            mark.curve(to: point(12, 2), controlPoint1: point(14, 4.2), controlPoint2: point(13, 2.8))
            mark.curve(to: point(8, 4.4), controlPoint1: point(11, 2.8), controlPoint2: point(10, 4.2))
            mark.curve(to: point(1.5, 10.5), controlPoint1: point(4.4, 4.8), controlPoint2: point(1.5, 6.3))
            mark.curve(to: point(3, 15.5), controlPoint1: point(1.5, 12.5), controlPoint2: point(2, 14))
            mark.close()
            // Mirrored, gently sloped eye openings use generous negative space.
            for mirrored in [false, true] {
                func eye(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
                    point(mirrored ? 24 - x : x, y)
                }
                mark.move(to: eye(4.7, 13.6))
                mark.curve(to: eye(10.4, 12.3), controlPoint1: eye(6.6, 14.5), controlPoint2: eye(9.2, 13.7))
                mark.curve(to: eye(7.7, 7.5), controlPoint1: eye(11, 9.5), controlPoint2: eye(10, 7.5))
                mark.curve(to: eye(4.7, 13.6), controlPoint1: eye(4.4, 7.5), controlPoint2: eye(3.7, 11))
                mark.close()
            }
            if appTile {
                NSGradient(starting: NSColor(calibratedRed: 0.16, green: 0.94, blue: 0.72, alpha: 1),
                           ending: NSColor(calibratedRed: 0.03, green: 0.69, blue: 0.95, alpha: 1))!
                    .draw(in: mark, angle: -25)
            } else {
                NSColor.black.setFill()
                mark.fill()
            }
            return true
        }
        image.isTemplate = !appTile
        image.accessibilityDescription = "RunHuddle"
        return image
    }
}
