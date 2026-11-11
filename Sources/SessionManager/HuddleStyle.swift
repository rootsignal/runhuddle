import AppKit
import SwiftUI
import SessionCore

enum HuddleStyle {
    static func adaptive(_ light: NSColor, _ dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        })
    }
    static let accent = adaptive(NSColor(red: 0.02, green: 0.40, blue: 0.52, alpha: 1), NSColor(red: 0.35, green: 0.82, blue: 0.91, alpha: 1))
    static let action = Color(red: 0.02, green: 0.40, blue: 0.52)
    static let canvas = adaptive(NSColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1), NSColor(red: 0.075, green: 0.09, blue: 0.12, alpha: 1))
    static let panel = adaptive(.white, NSColor(red: 0.105, green: 0.125, blue: 0.16, alpha: 1))
    static let raised = adaptive(NSColor(red: 0.97, green: 0.98, blue: 0.99, alpha: 1), NSColor(red: 0.145, green: 0.17, blue: 0.215, alpha: 1))
    static let border = Color.primary.opacity(0.10)
    static func inline(_ value: String) -> AttributedString {
        (try? AttributedString(markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(value)
    }
}

struct SessionStatusBadge: View {
    let state: SessionState
    var body: some View {
        Label(state.title, systemImage: state.symbol)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(state.color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(state.color.opacity(0.10), in: Capsule())
    }
}

struct AgentBadge: View {
    let provider: String
    var body: some View {
        Text(provider.uppercased()).font(.system(size: 9, weight: .bold, design: .rounded))
            .tracking(0.6).foregroundStyle(.secondary)
            .padding(.horizontal, 7).padding(.vertical, 4)
            .background(Color.primary.opacity(0.045), in: Capsule())
    }
}

struct SessionCardContent: View {
    let row: Session
    let title: String
    let summary: String
    let match: String?
    let pinned: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "folder").font(.system(size: 10)).foregroundStyle(HuddleStyle.accent)
                Text(row.project).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                if pinned { Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(HuddleStyle.accent) }
                Spacer(minLength: 8)
                AgentBadge(provider: row.simulated ? "Claude · demo" : row.provider)
            }
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary).lineLimit(1).fixedSize(horizontal: false, vertical: true)
            if let match {
                Text(SessionPresentation.excerpt(match, limit: 240)).font(.system(size: 12))
                    .foregroundStyle(.secondary).lineLimit(3)
            } else if !summary.isEmpty {
                Text(summary).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }
            HStack(spacing: 8) {
                Label(row.state.title, systemImage: row.state.symbol)
                    .font(.system(size: 10, weight: .medium)).foregroundStyle(row.state.color)
                if let usage = row.contextUsage, let fraction = usage.fraction {
                    HStack(spacing: 5) {
                        Image(systemName: "circle.dotted").font(.system(size: 10))
                        Text("\(Int((fraction * 100).rounded()))% context").monospacedDigit()
                    }.font(.system(size: 10)).foregroundStyle(fraction >= 0.8 ? Color.orange : .secondary)
                }
                Spacer(minLength: 4)
                Text(Date(timeIntervalSince1970: row.updated), style: .relative)
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                    .help("Time since recorded activity or a status change")
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SessionCardSurface: ViewModifier {
    let selected: Bool
    @ViewState private var hovered = false
    func body(content: Content) -> some View {
        content.padding(.horizontal, 12).padding(.vertical, 10)
            .background(selected ? HuddleStyle.accent.opacity(0.11) : hovered ? HuddleStyle.raised : Color.clear,
                        in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? HuddleStyle.accent.opacity(0.35) : Color.clear, lineWidth: 1))
            .overlay(alignment: .leading) {
                if selected { Capsule().fill(HuddleStyle.accent).frame(width: 3).padding(.vertical, 14) }
            }
            .contentShape(RoundedRectangle(cornerRadius: 12))
            .onHover { hovered = $0 }
    }
}

struct RecordedMessageCard: View {
    let title: String
    let value: String
    @ViewState private var expanded = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 10, weight: .semibold)).tracking(0.6).foregroundStyle(.secondary)
            if !expanded {
                Text(SessionPresentation.excerpt(value, limit: 220)).font(.system(size: 13)).lineSpacing(3).textSelection(.enabled).lineLimit(3).fixedSize(horizontal: false, vertical: true)
            }
            DisclosureGroup(expanded ? "Full message" : "Read full message", isExpanded: $expanded) {
                Text(HuddleStyle.inline(value)).font(.system(size: 13)).lineSpacing(3).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
            }.font(.caption).tint(HuddleStyle.accent)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
            .background(HuddleStyle.raised.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
    }
}

extension SessionState {
    var color: Color {
        switch self {
        case .needsInput: HuddleStyle.adaptive(NSColor(red: 0.62, green: 0.31, blue: 0.02, alpha: 1), .systemOrange)
        case .working: HuddleStyle.adaptive(NSColor(red: 0.06, green: 0.37, blue: 0.65, alpha: 1), NSColor(red: 0.32, green: 0.73, blue: 1, alpha: 1))
        case .idle: HuddleStyle.adaptive(NSColor(red: 0.10, green: 0.46, blue: 0.23, alpha: 1), .systemGreen)
        case .saved, .archived: .secondary
        case .disconnected: .red
        }
    }
    var symbol: String {
        switch self {
        case .needsInput: "hand.raised.fill"
        case .working: "bolt.fill"
        case .idle: "checkmark.circle"
        case .saved: "archivebox"
        case .disconnected: "wifi.slash"
        case .archived: "archivebox.fill"
        }
    }
}
