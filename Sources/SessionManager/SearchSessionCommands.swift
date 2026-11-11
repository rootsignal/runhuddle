import SwiftUI

private struct SearchSessionsKey: FocusedValueKey {
    typealias Value = () -> Void
}
extension FocusedValues {
    var searchSessions: (() -> Void)? {
        get { self[SearchSessionsKey.self] }
        set { self[SearchSessionsKey.self] = newValue }
    }
}
struct SearchSessionCommands: Commands {
    @FocusedValue(\.searchSessions) private var search
    var body: some Commands {
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Search sessions") { search?() }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(search == nil)
        }
    }
}
