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
        for (app, bundleID) in [("Terminal", "com.apple.Terminal"), ("Ghostty", "com.mitchellh.ghostty"), ("iTerm2", "com.googlecode.iterm2")] {
            guard let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else { continue }
            let items = app == "Terminal" ? "w.tabs()" : "w.terminals()"
            let fields = app == "Terminal" ? "[String(w.id()), t.tty(), t.customTitle(), '']" : "[String(w.id()), String(t.id()), t.name(), t.workingDirectory()]"

            let source = app == "iTerm2" ? """
            var app = Application(\(literal(bundleID)));
            var rows = [];
            if (app.running()) {
                for (var w of app.windows()) for (var tab of w.tabs()) for (var t of tab.sessions()) {
                    rows.push([String(w.id()), String(t.uniqueID()), t.name(), '', t.tty()]);
                }
            }
            JSON.stringify(rows);
            """ : """
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
                for row in rows where row.count >= 4 {
                    targets.append(TerminalTarget(app: app, window: row[0], identity: row[1], title: row[2], cwd: row[3], tty: row.count > 4 ? row[4] : "", applicationPID: running.processIdentifier))
                }
            } catch {
                let detail = error.localizedDescription
                errors.append(detail.contains("-1743")
                    ? "Allow RunHuddle to control \(app) in macOS Automation settings, then refresh."
                    : "\(app): \(detail)")
            }
        }
        targets += await TmuxNavigator.discover(targets)
        return (targets, errors)
    }
    static func focus(_ target: TerminalTarget) async throws {
        if target.tmux != nil { try await TmuxNavigator.focus(target); return }
        let bundles = ["Terminal": "com.apple.Terminal", "Ghostty": "com.mitchellh.ghostty", "iTerm2": "com.googlecode.iterm2"]
        guard let bundle = bundles[target.app], let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first,
              target.applicationPID == nil || target.applicationPID == app.processIdentifier else {
            throw failure("This terminal application restarted or closed. Refresh and choose it again.")
        }
        if target.app == "iTerm2" {
            let source = """
            var app = Application("com.googlecode.iterm2");
            function focusTarget() {
                if (!app.running()) throw Error('iTerm2 is no longer running.');
                for (var w of app.windows()) {
                    if (String(w.id()) !== \(literal(target.window))) continue;
                    for (var tab of w.tabs()) for (var t of tab.sessions()) {
                        if (String(t.uniqueID()) !== \(literal(target.identity))) continue;
                        if (t.tty() !== \(literal(target.tty)) || t.name() !== \(literal(target.title)))
                            throw Error('This iTerm2 pane changed. Refresh and choose it again.');
                        tab.select(); t.select(); w.select(); app.activate(); return true;
                    }
                }
                throw Error('This iTerm2 pane closed. Refresh and choose it again.');
            }
            JSON.stringify(focusTarget());
            """
            _ = try await run(source); return
        }
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
