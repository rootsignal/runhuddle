import SwiftUI
import AppKit

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
    var expanded: Bool = false
    @AppStorage("sessionListWidthFraction") private var listFraction = 0.54
    @ViewState private var dragStartWidth: CGFloat?
    @ViewBuilder var list: () -> ListContent
    @ViewBuilder var detail: () -> Detail
    var body: some View {
        GeometryReader { geometry in
            let sideBySide = geometry.size.width >= 660 && !expanded
            let dividerWidth: CGFloat = 9
            let available = max(0, geometry.size.width - dividerWidth)
            let minimumList: CGFloat = 280
            let maximumList = max(minimumList, available - 340)
            let preferredFraction = listFraction.isFinite ? listFraction : 0.54
            let listWidth = min(maximumList, max(minimumList, available * preferredFraction))
            let detailWidth = available - listWidth
            HStack(spacing: 0) {
                if !showDetails || sideBySide {
                    list().frame(width: showDetails ? listWidth : geometry.size.width, height: geometry.size.height)
                }
                if showDetails {
                    if sideBySide {
                        Rectangle().fill(Color.primary.opacity(dragStartWidth == nil ? 0.08 : 0.18))
                            .frame(width: 1)
                            .frame(width: dividerWidth, height: geometry.size.height)
                            .contentShape(Rectangle())
                            .onHover { hovering in
                                if hovering { NSCursor.resizeLeftRight.set() }
                                else if dragStartWidth == nil { NSCursor.arrow.set() }
                            }
                            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                                .onChanged { value in
                                    if dragStartWidth == nil { dragStartWidth = listWidth }
                                    let width = min(maximumList, max(minimumList, (dragStartWidth ?? listWidth) + value.translation.width))
                                    listFraction = width / available
                                    NSCursor.resizeLeftRight.set()
                                }
                                .onEnded { _ in dragStartWidth = nil; NSCursor.arrow.set() })
                            .simultaneousGesture(TapGesture(count: 2).onEnded { listFraction = 0.54 })
                            .onDisappear { dragStartWidth = nil; NSCursor.arrow.set() }
                            .accessibilityElement()
                            .accessibilityLabel("Session list and detail divider")
                            .accessibilityValue("Session list \(Int(listWidth / available * 100)) percent")
                            .accessibilityAdjustableAction { direction in
                                let change: CGFloat = direction == .increment ? 30 : -30
                                listFraction = min(maximumList, max(minimumList, listWidth + change)) / available
                            }
                            .help("Drag to resize the list and details. Double-click to reset.")
                    }
                    detail().frame(width: sideBySide ? detailWidth : geometry.size.width, height: geometry.size.height)
                }
            }.frame(width: geometry.size.width, height: geometry.size.height, alignment: .leading)
        }
    }
}
