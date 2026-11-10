#!/usr/bin/env python3
"""Build and install the standalone RunHuddle preview without sudo."""
import argparse
import os
import platform
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=Path.home() / 'Applications', help='Applications directory (default: ~/Applications)')
    parser.add_argument('--copilot-hooks', action='store_true', help='Install observational Copilot CLI hooks')
    parser.add_argument('--open', action='store_true', help='Launch after installing')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('RunHuddle requires macOS 14 or later.')
    if tuple(int(part) for part in platform.mac_ver()[0].split('.')[:1]) < (14,):
        parser.error('RunHuddle requires macOS 14 or later.')
    if sys.version_info < (3, 12):
        parser.error('Python 3.12 or later is required.')
    for command in ('swift', 'swiftc', 'iconutil', 'codesign'):
        if not shutil.which(command):
            parser.error(f'{command} is missing. Install Xcode or compatible Command Line Tools (Swift 6+).')
    root = Path(__file__).resolve().parents[1]
    destination = args.destination.expanduser().resolve()
    app = destination / 'RunHuddle.app'
    running = subprocess.run(['/bin/ps', '-axo', 'comm='], capture_output=True, text=True, check=True).stdout.splitlines()
    if str(app / 'Contents/MacOS/SessionManager') in (line.strip() for line in running):
        parser.error('Quit the installed RunHuddle before updating it, then run this command again.')
    if app.exists():
        with (app / 'Contents/Info.plist').open('rb') as file:
            existing = plistlib.load(file)
        if existing.get('CFBundleIdentifier') != 'local.rickbaker.agent-sessions':
            parser.error('Destination contains a different app; choose another destination.')
    os.chdir(root)
    run('/bin/bash', root / 'scripts/build-app.sh')
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.runhuddle-install-', dir=destination) as temp:
        stage, backup = Path(temp) / 'RunHuddle.app', Path(temp) / 'previous.app'
        shutil.copytree(root / 'dist/RunHuddle.app', stage, symlinks=True)
        run('/usr/bin/codesign', '--verify', '--deep', '--strict', stage)
        if app.exists():
            app.rename(backup)
        try:
            stage.rename(app)
        except OSError:
            if backup.exists():
                backup.rename(app)
            raise
    if args.copilot_hooks:
        run(app / 'Contents/Resources/python/bin/python3', '-E', '-s', '-B',
            app / 'Contents/Resources/bridge/copilot_bridge.py', 'install-hooks')
    print(f'Installed: {app}\nThis app is self-contained; the checkout is no longer needed to run it.')
    if args.open:
        run('/usr/bin/open', app)


if __name__ == '__main__':
    main()
