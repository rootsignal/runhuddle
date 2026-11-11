import SwiftUI

/// Size columns from the current window proposal, rather than cached native split widths.
struct WorkspaceLayout<Sidebar: View, Detail: View>: View {
    let sidebarVisible: Bool
    @ViewBuilder var sidebar: () -> Sidebar
    @ViewBuilder var detail: () -> Detail
    var body: some View {
        GeometryReader { geometry in
            let sidebarWidth = sidebarVisible ? min(220, max(180, geometry.size.width * 0.22)) : 0
            HStack(spacing: 0) {
                if sidebarVisible {
                    sidebar().frame(width: sidebarWidth, height: geometry.size.height).clipped()
                    Divider()
                }
                detail().frame(width: max(0, geometry.size.width - sidebarWidth - (sidebarVisible ? 1 : 0)), height: geometry.size.height)
            }.frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
        }
    }
}

struct SessionColumns<ListContent: View, Detail: View>: View {
    let showDetails: Bool
    @ViewBuilder var list: () -> ListContent
    @ViewBuilder var detail: () -> Detail
    var body: some View {
        GeometryReader { geometry in
            let sideBySide = geometry.size.width >= 660
            let detailWidth = min(520, max(340, geometry.size.width * 0.46))
            HStack(spacing: 0) {
                if !showDetails || sideBySide {
                    list().frame(width: showDetails ? max(0, geometry.size.width - detailWidth - 1) : geometry.size.width, height: geometry.size.height)
                }
                if showDetails {
                    if sideBySide { Divider() }
                    detail().frame(width: sideBySide ? detailWidth : geometry.size.width, height: geometry.size.height)
                }
            }.frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
        }
    }
}
