"""Exercise the actual Terminal JXA against a simulated scripting interface."""
import json
from pathlib import Path
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which('node'), 'Node is needed for the JXA simulation')
class TerminalTabLaunchTests(unittest.TestCase):
    def run_launch(self, scenario):
        source = (Path(__file__).resolve().parents[1] / 'Sources/SessionManager/TerminalNavigator.swift').read_text()
        script = source.split('let source = """', 1)[1].split('"""', 1)[0]
        script = script.replace('\\(canCreateTab ? "true" : "false")', 'true')
        script = script.replace('\\(literal(command))', '"resume-test-session"')
        harness = r'''
const scenario = SCENARIO;
let opened = false, ticks = 0, sent = [];
const oldTab = {tty: () => '/dev/old', selected: () => false, busy: () => true};
const newTab = {tty: () => '/dev/new', selected: () => true,
    busy: () => scenario === 'busy' || ticks < 90};
const extraTab = {tty: () => '/dev/extra', selected: () => false, busy: () => false};
const oldWindow = {id: () => 1, tabs: () => [oldTab]};
const newWindow = {id: () => 2, tabs: () => scenario === 'ambiguous' ? [oldTab, newTab, extraTab] : [oldTab, newTab]};
const terminal = {running: () => true, windows: () => opened ? [newWindow] : [oldWindow],
    activate: () => {}, doScript: (command, options) => sent.push([command, options.in.tty()])};
const system = {applicationProcesses: {byName: () => ({frontmost: () => true})},
    keystroke: () => { opened = true; }};
function Application(name) { return name === 'com.apple.Terminal' ? terminal : system; }
function delay() { ticks++; }
let error = null;
try { SCRIPT } catch (e) { error = e.message; }
console.log(JSON.stringify({sent, error, ticks}));
'''.replace('SCENARIO', json.dumps(scenario)).replace('SCRIPT', script)
        result = subprocess.run(['node', '-e', harness], text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def test_changed_window_and_slow_shell_send_only_to_new_tab(self):
        result = self.run_launch('ready')
        self.assertIsNone(result['error'])
        self.assertEqual(result['sent'], [['resume-test-session', '/dev/new']])
        self.assertGreater(result['ticks'], 60)

    def test_ambiguous_new_tabs_never_receive_command(self):
        result = self.run_launch('ambiguous')
        self.assertEqual(result['sent'], [])
        self.assertIn('Multiple new tabs', result['error'])

    def test_busy_new_tab_never_receives_command(self):
        result = self.run_launch('busy')
        self.assertEqual(result['sent'], [])
        self.assertIn('No resume command was sent', result['error'])
