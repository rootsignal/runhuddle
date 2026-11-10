import AppKit
import SessionCore

@MainActor enum TerminalNavigator {
    static func literal(_ text: String) -> String {
        String(data: try! JSONEncoder().encode(text), encoding: .utf8)!
    }
    static func failure(_ message: String) -> NSError {
        NSError(domain: "TerminalNavigator", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    // Apple Events can take seconds (or await permission). Never wait on the UI thread.
    static func run(_ source: String) async throws -> Data {
        try await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-l", "JavaScript", "-e", source]
            let output = Pipe(), errors = Pipe()
            process.standardOutput = output; process.standardError = errors
            try process.run()
            let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: timeout)
            defer { timeout.cancel() }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                let detail = String(data: errors.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
                throw NSError(domain: "TerminalNavigator", code: 1, userInfo: [NSLocalizedDescriptionKey:
                    detail.isEmpty ? "Terminal navigation timed out. Check macOS Automation permissions and try again." : detail])
            }
            return data
        }.value
    }
    static func discover() async -> (targets: [TerminalTarget], errors: [String]) {
        var targets: [TerminalTarget] = [], errors: [String] = []
        for (app, bundleID) in [("Terminal", "com.apple.Terminal"), ("Ghostty", "com.mitchellh.ghostty")] {
            guard !NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).isEmpty else { continue }
            let items = app == "Terminal" ? "w.tabs()" : "w.terminals()"
            let fields = app == "Terminal" ? "[String(w.id()), t.tty(), t.customTitle(), '']" : "[String(w.id()), String(t.id()), t.name(), t.workingDirectory()]"

            let source = """
            var app = Application(\(literal(bundleID)));
            var rows = [];
            if (app.running()) {
                for (var w of app.windows()) {
                    for (var t of \(items)) {
                        rows.push(\(fields));
                    }
                }
            }
            JSON.stringify(rows);
            """
            do {
                let rows = try JSONDecoder().decode([[String]].self, from: await run(source))
                for row in rows where row.count == 4 {
                    targets.append(TerminalTarget(app: app, window: row[0], identity: row[1], title: row[2], cwd: row[3]))
                }
            } catch {
                let detail = error.localizedDescription
                errors.append(detail.contains("-1743")
                    ? "Allow RunHuddle to control \(app) in macOS Automation settings, then refresh."
                    : "\(app): \(detail)")
            }
        }
        return (targets, errors)
    }
    static func focus(_ target: TerminalTarget) async throws {
        let terminal = target.app == "Terminal"
        let bundleID = terminal ? "com.apple.Terminal" : "com.mitchellh.ghostty"
        // Validate the chosen tab in the same operation that focuses it. Avoid rescanning
        // every terminal app, and reject reused tabs or changed titles/directories.
        let source = """
        var app = Application(\(literal(bundleID)));
        function clean(s) { return s.trim().replace(/^[\\u2800-\\u28ff]/, '').trim(); }
        function focusTarget() {
            if (!app.running()) throw Error('Terminal application is no longer running.');
            for (var w of app.windows()) {
                if (String(w.id()) !== \(literal(target.window))) continue;
                for (var t of \(terminal ? "w.tabs()" : "w.terminals()")) {
                    if (String(\(terminal ? "t.tty()" : "t.id()")) !== \(literal(target.identity))) continue;
                    if (clean(\(terminal ? "t.customTitle()" : "t.name()")) !== \(literal(TerminalTarget.cleanTitle(target.title)))\(terminal ? "" : " || t.workingDirectory() !== " + literal(target.cwd))) {
                        throw Error('This terminal changed. Refresh the list and choose it again.');
                    }
                    \(terminal ? "w.selectedTab = t; w.miniaturized = false; w.index = 1; app.activate();" : "app.focus(t); app.activate();")
                    return true;
                }
            }
            throw Error('This terminal closed. Refresh the list and choose it again.');
        }
        JSON.stringify(focusTarget());
        """
        _ = try await run(source)
    }
}
