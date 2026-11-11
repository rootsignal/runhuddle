import SwiftUI
import ImageIO
import SessionCore

struct LocalImagePreview: View {
    let path: String
    var remove: (() -> Void)? = nil
    @ViewState private var thumbnail: NSImage?
    @ViewState private var checked = false
    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let thumbnail { Image(nsImage: thumbnail).resizable().scaledToFit() }
                else { Image(systemName: "photo").font(.title2).foregroundStyle(.secondary) }
            }.frame(width: 72, height: 54).background(HuddleStyle.canvas, in: RoundedRectangle(cornerRadius: 5))
            VStack(alignment: .leading, spacing: 3) {
                Text(URL(fileURLWithPath: path).lastPathComponent).font(.caption.weight(.medium)).lineLimit(2).truncationMode(.middle)
                Text(checked && thumbnail == nil ? "Preview unavailable · local file reference" : "Local image reference").font(.caption2).foregroundStyle(.secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
            if let remove {
                Button(action: remove) { Image(systemName: "xmark") }.buttonStyle(QuietIconButtonStyle())
                    .help("Remove image reference").accessibilityLabel("Remove \(URL(fileURLWithPath: path).lastPathComponent)")
            }
        }.padding(8).background(HuddleStyle.raised, in: RoundedRectangle(cornerRadius: 8)).help(path)
            .accessibilityElement(children: .contain)
            .task(id: path) {
                thumbnail = nil; checked = false
                let image = await Task.detached(priority: .utility) {
                    let url = URL(fileURLWithPath: path)
                    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]), size.isRegularFile == true,
                          (size.fileSize ?? 0) <= 32 * 1024 * 1024,
                          let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil as CGImage? }
                    return CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 256, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
                }.value
                guard !Task.isCancelled else { return }
                if let image { thumbnail = NSImage(cgImage: image, size: .zero) }
                checked = true
            }
    }
}
