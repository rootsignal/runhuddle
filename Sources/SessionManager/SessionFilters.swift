import SwiftUI
import SessionCore

struct SessionFilterMenu: View {
    @EnvironmentObject var model: AppModel
    @ViewState private var presented = false
    @ViewState private var projectQuery = ""
    var body: some View {
        Button { presented.toggle() } label: {
            Label("Filters", systemImage: "line.3.horizontal.decrease.circle")
        }.accessibilityLabel("Filter sessions by tool and project").help("Filter sessions by tool and project")
            .popover(isPresented: $presented, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Filters").font(.headline)
                        Spacer()
                        Button("Done") { presented = false }
                    }
                    Text("Tool").font(.caption).foregroundStyle(.secondary)
                    Picker("Tool", selection: $model.provider) {
                        ForEach(["All tools", "Codex", "Claude", "Copilot"], id: \.self) { Text($0).tag($0) }
                    }.pickerStyle(.segmented).labelsHidden()
                    Text("Project").font(.caption).foregroundStyle(.secondary)
                    TextField("Find a project", text: $projectQuery).textFieldStyle(.roundedBorder)
                    ScrollView {
                        VStack(spacing: 2) {
                            projectRow("All projects", title: "All projects")
                            if !projectQuery.isEmpty && !model.projectPaths.contains(where: { $0.localizedCaseInsensitiveContains(projectQuery) }) {
                                Text("No projects match “\(projectQuery)”").font(.callout).foregroundStyle(.secondary).padding(12)
                            }
                            ForEach(model.projectPaths.filter { projectQuery.isEmpty || $0.localizedCaseInsensitiveContains(projectQuery) }, id: \.self) { path in
                                projectRow(path, title: ProjectFilter.title(path))
                            }
                        }
                    }.frame(height: 220)
                    Button("Clear filters") { model.provider = "All tools"; model.projectFilter = "All projects"; projectQuery = "" }
                        .disabled(model.provider == "All tools" && model.projectFilter == "All projects")
                }.padding(16).frame(width: 360)
            }
    }
    private func projectRow(_ path: String, title: String) -> some View {
        Button { model.projectFilter = path } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).lineLimit(1)
                    if path != "All projects" && path != ProjectFilter.temporary {
                        Text(path.replacingOccurrences(of: NSHomeDirectory(), with: "~")).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                if model.projectFilter == path { Image(systemName: "checkmark").foregroundStyle(HuddleStyle.accent) }
            }.padding(7).frame(maxWidth: .infinity, alignment: .leading)
                .background(model.projectFilter == path ? HuddleStyle.accent.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).help(path)
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
                        chip(ProjectFilter.title(model.projectFilter), symbol: "folder", help: "Remove project filter: " + model.projectFilter) { model.projectFilter = "All projects" }
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
