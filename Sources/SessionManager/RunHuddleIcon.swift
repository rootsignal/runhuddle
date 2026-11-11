import AppKit

/// One RH silhouette shared by the app tile and macOS template menu-bar icon.
enum RunHuddleIcon {
    static func image(size: CGFloat = 18, appTile: Bool = false) -> NSImage {
        let width = appTile ? size : size * 4 / 3
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
            let scale = appTile ? size * 0.72 / 24 : size / 18
            let transform = NSAffineTransform()
            transform.translateX(by: (width - 24 * scale) / 2, yBy: (size - 18 * scale) / 2)
            transform.scale(by: scale)
            transform.concat()
            // The R bowl joins the H's left stem. Its leg merges into that stem,
            // removing the tiny triangular counter that would clog at menu size.
            func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
                NSPoint(x: x + (y - 9) * 0.16 + 1, y: y)
            }
            let mark = NSBezierPath()
            mark.windingRule = .evenOdd
            mark.move(to: point(1, 2))
            mark.line(to: point(1, 16))
            mark.line(to: point(9.5, 16))
            mark.curve(to: point(13, 12.5), controlPoint1: point(12, 16), controlPoint2: point(13, 15))
            for (x, y): (CGFloat, CGFloat) in [
                (13, 11), (18, 11), (18, 16), (21, 16), (21, 2),
                (18, 2), (18, 8), (13, 8), (13, 2), (9, 2), (4, 8), (4, 2)
            ] { mark.line(to: point(x, y)) }
            mark.close()
            // Generous R counter remains open in the monochrome template.
            mark.move(to: point(4, 10))
            mark.line(to: point(8.5, 10))
            mark.curve(to: point(8.5, 13), controlPoint1: point(10.5, 10), controlPoint2: point(10.5, 13))
            mark.line(to: point(4, 13))
            mark.close()
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
