import Foundation
import SwiftUI
import SessionCore

struct LocalCleanupState: Codable, Equatable {
    var archived: Set<String> = []
    var removed: Set<String> = []
}

struct LocalHistoryPlan: Decodable {
    let provider: String
    let sessionID: String
    let paths: [String]
    let fingerprint: String
}

struct BulkCleanupReview: Identifiable {
    struct Entry: Identifiable {
        let session: Session
        let name: String
        let native: CleanupPlan?
        let local: LocalHistoryPlan?
        var id: String { session.id }
        var count: Int { native?.affected.count ?? 1 }
    }
    let id = UUID()
    let operation: String
    let entries: [Entry]
    let skipped: [String]
    var count: Int { entries.reduce(0) { $0 + $1.count } }
    var removesHistory: Bool { operation == "delete" || operation == "archive-delete" }
    var title: String {
        switch operation {
        case "archive-delete": "Archive and delete selected histories"
        case "delete": "Remove selected histories"
        case "restore": "Restore sessions"
        default: "Archive sessions"
        }
    }
}

struct BulkCleanupView: View {
    @EnvironmentObject var model: AppModel
    let review: BulkCleanupReview
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(review.title).font(.title2.bold())
            Text("\(review.count) \(review.count == 1 ? "session" : "sessions") eligible · \(review.skipped.count) \(review.skipped.count == 1 ? "selection" : "selections") skipped")
            if review.operation == "archive-delete" {
                Text("Closed sessions are archived first, then removed. Already archived sessions are removed directly. If removal fails, some sessions may remain archived.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Text(review.removesHistory
                 ? "Codex histories are permanently deleted. Claude and Copilot history files are moved to the Mac’s Trash. Session annotations, handoff drafts, and search entries are removed. Repository files are not targeted. Project notes are kept. Save any summaries or handoffs you want to keep first."
                 : review.operation == "restore" ? "Restores archived sessions to the main list."
                 : "Codex uses its native archive. Claude and Copilot are hidden only in RunHuddle; their agent history stays intact. Running sessions are skipped.")
                .font(.callout).foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(review.entries) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(entry.session.provider) · \(entry.name)").bold()
                            if review.removesHistory {
                                let count = model.savedWork.filter { $0.sourceID == entry.session.id }.count
                                Text(count == 0 ? "No independent saved record" : "\(count) independent saved record(s) will be kept")
                                    .font(.caption).foregroundStyle(.secondary)
                                Button("Save summary first…") {
                                    model.bulkReview = nil
                                    Task { @MainActor in
                                        try? await Task.sleep(for: .milliseconds(250))
                                        model.workError = nil; model.workSource = entry.session
                                    }
                                }.disabled(model.cleaning)
                            }
                            if let native = entry.native {
                                ForEach(native.affected) { row in Text(row.title).font(.caption) }
                            }
                            if let local = entry.local {
                                if local.paths.isEmpty {
                                    Text("No history files remain. Remove this session’s RunHuddle entry and local notes only.")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                ForEach(local.paths, id: \.self) { Text($0).font(.caption).textSelection(.enabled) }
                            }
                        }
                    }
                    if !review.skipped.isEmpty {
                        Divider()
                        Text("Skipped").bold()
                        ForEach(Array(review.skipped.enumerated()), id: \.offset) { _, reason in
                            Text(reason).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.frame(maxHeight: 340)
            HStack {
                Button("Cancel") { model.bulkReview = nil }.disabled(model.cleaning)
                Spacer()
                if model.cleaning { ProgressView().controlSize(.small); Text(model.cleanupProgress).font(.caption) }
                Button(review.operation == "archive-delete" ? "Archive and delete" : review.removesHistory ? "Confirm removal" : "Confirm", role: review.removesHistory ? .destructive : nil) {
                    Task { await model.applyBulkCleanup(review) }
                }.disabled(model.cleaning || review.entries.isEmpty)
            }
        }.padding(24).frame(width: 620).interactiveDismissDisabled(model.cleaning)
    }
}
