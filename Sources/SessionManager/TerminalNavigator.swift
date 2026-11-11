import AppKit
import ApplicationServices
import SessionCore

@MainActor enum TerminalNavigator {
    static func literal(_ text: String) -> String {
        String(data: try! JSONEncoder().encode(text), encoding: .utf8)!
    }
    static func failure(_ message: String) -> NSError {
        NSError(domain: "TerminalNavigator", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    // Apple Events can take seconds (or await permission). Never wait on the UI thread.
    static func run(_ source: String, language: String = "JavaScript") async throws -> Data {
        try await Task.detached {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
            process.arguments = ["-l", language, "-e", source]
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
    static func launchNew(_ command: String, cwd: String, terminal: PreferredTerminal, preferTab: Bool) async throws -> String? {
        guard NSWorkspace.shared.urlForApplication(withBundleIdentifier: terminal.bundleID) != nil else {
            throw failure("\(terminal.title) is not installed. Choose an installed terminal in Terminal settings.")
        }
        if let script = terminal.creationScript(command: command, cwd: cwd, preferTab: preferTab) {
            _ = try await run(script, language: "AppleScript")
            return nil
        }
        return try await launchNew(command, preferTab: preferTab)
    }

    // Return a note only when tab creation was unavailable before any command was sent.
    static func launchNew(_ command: String, preferTab: Bool) async throws -> String? {
        let canCreateTab = preferTab && AXIsProcessTrusted()
        let source = """
        var app = Application("com.apple.Terminal");
        function launch() {
            if (!\(canCreateTab ? "true" : "false") || !app.running() || app.windows().length === 0) {
                app.doScript(\(literal(command))); app.activate(); return 'window';
            }
            var w = app.windows()[0];
            // Terminal can change its exposed window identity when a tab becomes active.
            // Snapshot every TTY so an existing tab can never qualify as the new one.
            var before = [];
            for (var win of app.windows()) {
                for (var tab of win.tabs()) before.push(tab.tty());
            }
            w.miniaturized = false; w.index = 1; app.activate();
            var se = Application('com.apple.systemevents');
            var process = se.applicationProcesses.byName('Terminal');
            for (var i = 0; i < 30 && !process.frontmost(); i++) delay(0.05);
            if (!process.frontmost()) throw Error('Could not bring Terminal forward. No command was sent.');
            se.keystroke('t', {using: 'command down'});
            for (var i = 0; i < 160; i++) {
                delay(0.05);
                var matches = [];
                for (var win of app.windows()) {
                    for (var tab of win.tabs()) {
                        var tty = tab.tty();
                        if (tty && before.indexOf(tty) < 0 && !matches.some(function(t) { return t.tty() === tty; })) matches.push(tab);
                    }
                }
                if (matches.length === 1 && matches[0].selected() && !matches[0].busy()) {
                    app.doScript(\(literal(command)), {in: matches[0]}); app.activate(); return 'tab';
                }
                if (matches.length > 1) throw Error('Multiple new tabs appeared. No command was sent; choose a tab manually.');
            }
            throw Error('The new Terminal tab could not be confirmed as ready within 8 seconds. No resume command was sent. Close the empty tab before trying again.');
        }
        JSON.stringify(launch());
        """
        let result = try await run(source)
        let opened = try? JSONDecoder().decode(String.self, from: result)
        return preferTab && !canCreateTab && opened == "window"
            ? "Opened in a window because Terminal tab access is off." : nil
    }

    static func rename(_ target: TerminalTarget, title: String) async throws {
        guard target.app == "Terminal", target.tmux == nil,
              let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Terminal").first,
              target.applicationPID == app.processIdentifier else { throw failure("This tab cannot be renamed automatically.") }
        _ = try await run("""
        var app = Application('com.apple.Terminal');
        function rename() {
            if (!app.running()) throw Error('Terminal closed.');
            for (var w of app.windows()) {
                if (String(w.id()) !== \(literal(target.window))) continue;
                for (var t of w.tabs()) {
                    if (t.tty() !== \(literal(target.identity))) continue;
                    if (t.customTitle() !== \(literal(target.title))) throw Error('Tab changed; title was not updated.');
                    t.customTitle = \(literal(title)); return true;
                }
            }
            throw Error('Tab closed; title was not updated.');
        }
        JSON.stringify(rename());
        """)
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
