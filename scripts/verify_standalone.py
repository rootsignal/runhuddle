#!/usr/bin/env python3
"""Verify a relocated app with an empty home and no developer tools on PATH."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='runhuddle standalone ') as temp:
    folder = Path(temp)
    app = folder / 'Moved App/RunHuddle.app'
    shutil.copytree(root / 'dist/RunHuddle.app', app, symlinks=True)
    home = folder / 'Empty Home'
    home.mkdir()
    resources = app / 'Contents/Resources'
    python = resources / 'python/bin/python3'
    environment = {'HOME': str(home), 'PATH': '/usr/bin:/bin', 'TMPDIR': str(folder)}
    def run(*args, **kwargs):
        return subprocess.run([str(arg) for arg in args], cwd=home, env=environment,
                              check=True, capture_output=True, text=True, **kwargs).stdout
    def bridge(script, *args, **kwargs):
        return run(python, '-E', '-s', '-B', resources / 'bridge' / script, *args, **kwargs)
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    assert 'ProjectRoot' not in info
    run(python, '-E', '-s', '-B', '-c', 'import websockets, yaml, sqlite3; sqlite3.connect(":memory:").execute("CREATE VIRTUAL TABLE search USING fts5(text)")')
    run(python, '-E', '-s', '-B', '-c', 'import sys; sys.path.insert(0, sys.argv[1]); import codex_events, handoff_ai, claude_channel, copilot_reply', resources / 'bridge')
    assert json.loads(bridge('session_reply.py', input=json.dumps({'provider':'Copilot','action':'install','sessionID':'','executable':''})))['outcome'] == 'installed'
    assert (home / '.copilot/extensions/runhuddle-replies/extension.mjs').exists()
    assert (home / '.copilot/extensions/runhuddle-replies/bridge.mjs').exists()
    assert json.loads(bridge('copilot_bridge.py', 'snapshot')) == []
    bridge('copilot_bridge.py', 'install-hooks')
    config = json.loads((home / '.copilot/hooks/agent-session-manager.json').read_text())
    entry = config['hooks']['agentStop'][0]
    assert str(app) in entry['exec'] and '-B' in entry['args']
    assert run(entry['exec'], *entry['args'], input='{}') == ''
    assert json.loads(bridge('claude_bridge.py', 'snapshot')) == []
    assert json.loads(bridge('claude_bridge.py', 'repair-hooks')) == {'repaired': False}
    bridge('claude_bridge.py', 'install-hooks')
    claude = json.loads((home / '.claude/settings.json').read_text())
    import shlex
    command = shlex.split(claude['hooks']['SessionStart'][0]['hooks'][0]['command'])
    assert str(app) in command[0] and '-B' in command
    assert run(*command, input='{}') == ''
    bridge('history_search.py', 'search', 'standalone')
    assert info['SUPublicEDKey'] and info['SURequireSignedFeed'] and info['SUVerifyUpdateBeforeExtraction']
    assert (app / 'Contents/Frameworks/Sparkle.framework').exists()
    for path in app.rglob('*'):
        if path.is_symlink():
            assert path.resolve().is_relative_to(app.resolve()), f'External symlink: {path}'
        elif path.is_file():
            with path.open('rb') as file:
                magic = file.read(4)
            if magic in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe'):
                dependencies = run('/usr/bin/otool', '-L', path).splitlines()[1:]
                own_ids = run('/usr/bin/otool', '-D', path).splitlines()[1:]
                for dep in dependencies:
                    if '(compatibility version ' not in dep:
                        continue  # Universal-binary architecture headings are not dependencies.
                    name = dep.strip().split(' (')[0]
                    if name in own_ids:
                        continue
                    assert name.startswith(('@', '/usr/lib/', '/System/Library/')), f'Nonportable dependency: {name}'
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
print('Standalone relocation, imports, FTS, hooks, search, dependencies and signature passed.')
