import SwiftUI

struct SessionFilterMenu: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Menu {
            Picker("Tool", selection: $model.provider) {
                ForEach(["All tools", "Codex", "Claude", "Copilot"], id: \.self) { Text($0).tag($0) }
            }
            Picker("Project", selection: $model.projectFilter) {
                Text("All projects").tag("All projects")
                ForEach(model.projectPaths, id: \.self) { path in
                    Text(path.replacingOccurrences(of: NSHomeDirectory(), with: "~")).tag(path)
                }
            }
            Divider()
            Button("Clear filters") { model.provider = "All tools"; model.projectFilter = "All projects" }
                .disabled(model.provider == "All tools" && model.projectFilter == "All projects")
        } label: {
            Label("Filters", systemImage: "line.3.horizontal.decrease.circle")
        }.help("Filter sessions by tool and project")
    }
}

struct SessionFilterChips: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        if model.provider != "All tools" || model.projectFilter != "All projects" {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    if model.provider != "All tools" {
                        chip(model.provider, symbol: "terminal", help: "Remove tool filter") { model.provider = "All tools" }
                    }
                    if model.projectFilter != "All projects" {
                        chip(URL(fileURLWithPath: model.projectFilter).lastPathComponent, symbol: "folder", help: "Remove project filter: " + model.projectFilter) { model.projectFilter = "All projects" }
                    }
                    Button("Clear filters") { model.provider = "All tools"; model.projectFilter = "All projects" }
                        .buttonStyle(.plain).font(.caption).foregroundStyle(.secondary)
                }.padding(.horizontal, 20).padding(.vertical, 6)
            }.scrollIndicators(.hidden).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func chip(_ title: String, symbol: String, help: String, remove: @escaping () -> Void) -> some View {
        Button(action: remove) {
            HStack(spacing: 6) {
                Label(title, systemImage: symbol).lineLimit(1)
                Image(systemName: "xmark").font(.caption2)
            }.font(.caption).padding(.horizontal, 10).padding(.vertical, 6)
                .background(HuddleStyle.accent.opacity(0.12), in: Capsule()).contentShape(Capsule())
        }.buttonStyle(.plain).help(help).accessibilityLabel(help)
    }
}
