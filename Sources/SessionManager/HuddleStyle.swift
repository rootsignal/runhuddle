import AppKit
import SwiftUI
import SessionCore

enum HuddleStyle {
    static func adaptive(_ light: NSColor, _ dark: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        })
    }
    private static func themed(_ key: KeyPath<TerminalTheme, String>, fallback: Color) -> Color {
        let options = TerminalOptionsPreference.stored
        guard options.coordinateApp else {
            if key == \TerminalTheme.accent, let hex = UserDefaults.standard.string(forKey: "appAccentColor"), !hex.isEmpty {
                return Color(nsColor: TerminalOptionsPreference.color(hex))
            }
            return fallback
        }
        func value(_ dark: Bool) -> NSColor {
            let hex = key == \TerminalTheme.accent ? (options.customAccent ?? options.preset(dark: dark)[keyPath: key]) : options.preset(dark: dark)[keyPath: key]
            return TerminalOptionsPreference.color(hex)
        }
        return adaptive(value(false), value(true))
    }
    static var accent: Color { themed(\.accent, fallback: adaptive(NSColor(red: 0.02, green: 0.40, blue: 0.52, alpha: 1), NSColor(red: 0.35, green: 0.82, blue: 0.91, alpha: 1))) }
    static var action: Color {
        let options = TerminalOptionsPreference.stored
        guard options.coordinateApp else {
            if let hex = UserDefaults.standard.string(forKey: "appAccentColor"), !hex.isEmpty { return Color(nsColor: TerminalOptionsPreference.color(hex)) }
            return Color(red: 0.02, green: 0.40, blue: 0.52)
        }
        func color(_ dark: Bool) -> NSColor {
            let preset = options.preset(dark: dark)
            let accent = TerminalOptionsPreference.color(options.customAccent ?? preset.accent)
            return preset.dark ? accent.blended(withFraction: 0.45, of: .black)! : accent
        }
        return adaptive(color(false), color(true))
    }
    static var canvas: Color { themed(\.canvas, fallback: adaptive(NSColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1), NSColor(red: 0.075, green: 0.09, blue: 0.12, alpha: 1))) }
    static var panel: Color { themed(\.panel, fallback: adaptive(.white, NSColor(red: 0.105, green: 0.125, blue: 0.16, alpha: 1))) }
    static var raised: Color { themed(\.raised, fallback: adaptive(NSColor(red: 0.97, green: 0.98, blue: 0.99, alpha: 1), NSColor(red: 0.145, green: 0.17, blue: 0.215, alpha: 1))) }
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
        Text(provider).font(.system(size: 11, weight: .medium))
            .tracking(0.1).foregroundStyle(.secondary)
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
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary).lineLimit(2).help(title).fixedSize(horizontal: false, vertical: true)
            if let match {
                Text(SessionPresentation.excerpt(match, limit: 240)).font(.system(size: 12))
                    .foregroundStyle(.secondary).lineLimit(3)
            } else if !summary.isEmpty {
                Text(summary).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { metadata; Spacer(minLength: 4); activityAge }
                VStack(alignment: .leading, spacing: 5) { metadata; activityAge }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private var metadata: some View {
            HStack(spacing: 8) {
                Label(row.state.title, systemImage: row.state.symbol)
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(row.state.color)
                if let usage = row.contextUsage, let fraction = usage.fraction {
                    ContextUsageIndicator(fraction: fraction)
                }
                if let count = row.compactions, count.count > 0 {
                    Label("\(count.count)", systemImage: "arrow.triangle.2.circlepath")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                        .help("\(count.count) compactions observed. " + count.source)
                        .accessibilityLabel("\(count.count) compactions observed")
                }
            }.fixedSize(horizontal: true, vertical: false)
    }
    private var activityAge: some View {
        Text(Date(timeIntervalSince1970: row.updated), style: .relative)
            .font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary)
            .help("Time since recorded activity or a status change")
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
        case .disconnected: .secondary
        }
    }
    var symbol: String {
        switch self {
        case .needsInput: "hand.raised.fill"
        case .working: "bolt.fill"
        case .idle: "checkmark.circle"
        case .saved: "archivebox"
        case .disconnected: "archivebox"
        case .archived: "archivebox.fill"
        }
    }
}

/// Keep disclosure headers usable across their entire row, including empty space.
struct HuddleDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                configuration.isExpanded.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(configuration.isExpanded ? 90 : 0))
                        .frame(width: 14)
                        .accessibilityHidden(true)
                    configuration.label
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(DisclosureHeaderButtonStyle())
            .accessibilityValue(configuration.isExpanded ? "Expanded" : "Collapsed")
            .accessibilityHint("Toggle section")
            if configuration.isExpanded {
                configuration.content
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 28)
                    .padding(.vertical, 6)
            }
        }
    }
}

private struct DisclosureHeaderButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Header(configuration: configuration)
    }
    private struct Header: View {
        let configuration: ButtonStyle.Configuration
        @ViewState private var hovered = false
        var body: some View {
            configuration.label
                .background(HuddleStyle.accent.opacity(configuration.isPressed ? 0.15 : hovered ? 0.07 : 0),
                            in: RoundedRectangle(cornerRadius: 6))
                .onHover { hovered = $0 }
        }
    }
}

struct ContextUsageIndicator: View {
    let fraction: Double
    private var percent: Int { Int((fraction * 100).rounded()) }
    var body: some View {
        HStack(spacing: 5) {
            ZStack {
                Circle().stroke(Color.secondary.opacity(0.2), lineWidth: 2)
                Circle().trim(from: 0, to: min(1, max(0, fraction)))
                    .stroke(fraction >= 0.8 ? Color.orange : HuddleStyle.accent,
                            style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }.frame(width: 12, height: 12).accessibilityHidden(true)
            Text("\(percent)%").monospacedDigit()
        }.font(.system(size: 11)).foregroundStyle(fraction >= 0.8 ? Color.orange : .secondary)
            .help("Context window: \(percent)% used · last reported estimate")
            .accessibilityElement(children: .ignore).accessibilityLabel("Context window \(percent) percent used")
    }
}

/// A snapshot distribution, not a historical chart or a progress estimate.
struct ActivityOverview: View {
    let sessions: [Session]
    private var states: [SessionState] { [.needsInput, .working, .idle] }
    private func count(_ state: SessionState) -> Int { sessions.filter { $0.state == state }.count }
    private var total: Int { states.reduce(0) { $0 + count($1) } }
    var body: some View {
        if total > 0 {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { legend; distribution.frame(width: 88, height: 5) }
                legend
            }.padding(.top, 3)
        }
    }
    private var legend: some View {
        HStack(spacing: 12) {
            ForEach(states.filter { count($0) > 0 }, id: \.self) { state in
                Label("\(count(state)) \(state == .needsInput ? "waiting" : state.title.lowercased())", systemImage: state.symbol)
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(state.color)
            }
        }
    }
    private var distribution: some View {
        GeometryReader { geometry in
            HStack(spacing: 2) {
                ForEach(states.filter { count($0) > 0 }, id: \.self) { state in
                    Capsule().fill(state.color.opacity(0.7))
                        .frame(width: max(0, geometry.size.width - 4) * CGFloat(count(state)) / CGFloat(total))
                }
            }
        }.accessibilityHidden(true).help("Current activity across the sessions in this view")
    }
}

struct QuietIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.frame(minWidth: 30, minHeight: 30)
            .foregroundStyle(HuddleStyle.accent)
            .background(HuddleStyle.accent.opacity(configuration.isPressed ? 0.18 : 0.07), in: RoundedRectangle(cornerRadius: 7))
            .contentShape(RoundedRectangle(cornerRadius: 7))
    }
}
