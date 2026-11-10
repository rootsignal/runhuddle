import AppKit

/// A forward-leaning H with a rising crossbar. The menu-bar version is a template
/// so macOS supplies the right color for light, dark, and selected appearances.
enum RunHuddleIcon {
    static func image(size: CGFloat = 18, appTile: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            if appTile {
                let tile = NSBezierPath(roundedRect: rect.insetBy(dx: size * 0.04, dy: size * 0.04),
                                        xRadius: size * 0.21, yRadius: size * 0.21)
                NSGradient(starting: NSColor(calibratedRed: 0.15, green: 0.20, blue: 0.39, alpha: 1),
                           ending: NSColor(calibratedRed: 0.035, green: 0.055, blue: 0.12, alpha: 1))!
                    .draw(in: tile, angle: -70)
            }
            let inset: CGFloat = appTile ? size * 0.20 : 0
            let scale = (size - inset * 2) / 18
            let transform = NSAffineTransform()
            transform.translateX(by: inset, yBy: inset)
            transform.scale(by: scale)
            transform.concat()
            // Forward lean and a rising crossbar make a single distinctive H.
            // One solid silhouette survives monochrome rendering at 18 points.
            let mark = NSBezierPath()
            let points: [(CGFloat, CGFloat)] = [
                (2.5, 2), (2.5, 14.5), (4, 16), (6.5, 16),
                (6.5, 10), (11.5, 12), (11.5, 16), (15.5, 16),
                (15.5, 3.5), (14, 2), (11.5, 2), (11.5, 8),
                (6.5, 6), (6.5, 2)
            ]
            for (index, point) in points.enumerated() {
                let p = NSPoint(x: point.0 + (point.1 - 9) * 0.12, y: point.1)
                if index == 0 { mark.move(to: p) } else { mark.line(to: p) }
            }
            mark.close()
            if appTile {
                NSGradient(starting: NSColor(calibratedRed: 0.22, green: 0.65, blue: 1, alpha: 1),
                           ending: NSColor(calibratedRed: 0.48, green: 1, blue: 0.76, alpha: 1))!
                    .draw(in: mark, angle: 65)
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
