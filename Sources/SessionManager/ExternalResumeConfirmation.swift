import SwiftUI

struct ExternalResumeConfirmation: ViewModifier {
    @EnvironmentObject var model: AppModel
    func body(content: Content) -> some View {
        content
        .alert("Resume this conversation here?", isPresented: Binding(
            get: { model.externalResume != nil }, set: { if !$0 { model.externalResume = nil } }
        ), presenting: model.externalResume) { row in
            Button("Cancel", role: .cancel) { model.externalResume = nil }
            Button("Resume here") {
                model.externalResume = nil
                model.resume(row, allowExternal: true)
            }
        } message: { row in
            Text("\(row.provider) reports this conversation is still open, or its status is uncertain. This opens the saved conversation in a new RunHuddle terminal; it does not reconnect to or stop the original process. If that process is still alive, both agents may modify the same files and conversation. The agent CLI may refuse a concurrent resume.")
        }
    }
}
