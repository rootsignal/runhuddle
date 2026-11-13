import SwiftUI
import SessionCore

struct SessionFilterMenu: View {
    @EnvironmentObject var model: AppModel
    @ViewState private var presented = false
    @ViewState private var projectQuery = ""
    var body: some View {
        HStack(spacing: 8) {
            Menu {
                Picker("Tool", selection: $model.provider) {
                    ForEach(["All tools", "Codex", "Claude", "Copilot", "Shell"], id: \.self) { Text($0).tag($0) }
                }.pickerStyle(.inline)
            } label: { Label(model.provider, systemImage: "slider.horizontal.3") }
                .help("Filter by agent tool").accessibilityLabel("Tool: " + model.provider)
            Button { presented.toggle() } label: {
                HStack(spacing: 5) {
                    Image(systemName: "folder")
                    Text(model.projectFilter == "All projects" ? "All projects" : ProjectFilter.title(model.projectFilter)).lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption2)
                }.frame(maxWidth: 180)
            }.help("Project: " + model.projectFilter)
                .accessibilityLabel("Project: " + model.projectFilter)
                .popover(isPresented: $presented, arrowEdge: .bottom) {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Project").font(.headline)
                            Spacer()
                            Button("Done") { presented = false }
                        }
                        TextField("Find a project", text: $projectQuery).textFieldStyle(.roundedBorder)
                        ScrollView {
                            VStack(spacing: 2) {
                                projectRow("All projects", title: "All projects")
                                if !projectQuery.isEmpty && !model.projectPaths.contains(where: { $0.localizedCaseInsensitiveContains(projectQuery) }) {
                                    Text("No matching projects").foregroundStyle(.secondary).padding(12)
                                }
                                ForEach(model.projectPaths.filter { projectQuery.isEmpty || $0.localizedCaseInsensitiveContains(projectQuery) }, id: \.self) { path in
                                    projectRow(path, title: ProjectFilter.title(path))
                                }
                            }
                        }.frame(height: 220)
                    }.padding(16).frame(width: 360)
                }
            if model.provider != "All tools" || model.projectFilter != "All projects" {
                Button { model.provider = "All tools"; model.projectFilter = "All projects"; projectQuery = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                }.buttonStyle(.plain).help("Clear tool and project filters").accessibilityLabel("Clear tool and project filters")
            }
        }.buttonStyle(.bordered).controlSize(.small)
    }
    private func projectRow(_ path: String, title: String) -> some View {
        Button { model.projectFilter = path; presented = false; projectQuery = "" } label: {
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
