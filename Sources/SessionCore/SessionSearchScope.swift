import Foundation

public enum SessionSearchScope: String, CaseIterable {
    case everywhere = "Everywhere"
    case currentView = "Current view"

    public func includes(_ row: Session, searching: Bool, filter: String, provider: String, project: String, pinned: Set<String>) -> Bool {
        return (provider == "All tools" || row.provider == provider)
            && (project == "All projects" || row.cwd == project)
            && ((searching && self == .everywhere) || SessionPresentation.includes(row, filter: filter, pinned: pinned))
    }
}
