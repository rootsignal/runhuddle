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
import time


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=Path.home() / 'Applications', help='Applications directory (default: ~/Applications)')
    parser.add_argument('--copilot-hooks', action='store_true', help='Install observational Copilot CLI hooks')
    parser.add_argument('--restart', action='store_true', help='Stage and verify first, request a normal quit, then install and reopen')
    parser.add_argument('--built-app', type=Path, help='Install an already-built local bundle after signature verification')
    parser.add_argument('--open' , action='store_true', help='Launch after installing')
    parser.add_argument('--claude-hooks', action='store_true', help='Install observational Claude Code hooks')
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
    if not args.restart and str(app / 'Contents/MacOS/SessionManager') in (line.strip() for line in running):
        parser.error('Quit the installed RunHuddle before updating it, then run this command again.')
    if app.exists():
        with (app / 'Contents/Info.plist').open('rb') as file:
            existing = plistlib.load(file)
        if existing.get('CFBundleIdentifier') != 'local.rickbaker.agent-sessions':
            parser.error('Destination contains a different app; choose another destination.')
    os.chdir(root)
    os.environ['RUNHUDDLE_BUILD_PYTHON'] = sys.executable
    if not args.built_app:
        run('/bin/bash', root / 'scripts/build-app.sh')
    source = args.built_app.resolve() if args.built_app else root / 'dist/RunHuddle.app'
    with (source / 'Contents/Info.plist').open('rb') as file:
        if plistlib.load(file).get('CFBundleIdentifier') != 'local.rickbaker.agent-sessions':
            parser.error('The prepared bundle is not RunHuddle.')
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.runhuddle-install-', dir=destination) as temp:
        stage, backup = Path(temp) / 'RunHuddle.app', Path(temp) / 'previous.app'
        shutil.copytree(source, stage, symlinks=True)
        run('/usr/bin/codesign', '--verify', '--deep', '--strict', stage)
        def is_running():
            lines = subprocess.check_output(['/bin/ps', '-axo', 'comm='], text=True).splitlines()
            return str(app / 'Contents/MacOS/SessionManager') in [line.strip() for line in lines]
        if args.restart and is_running():
            # Normal quit honors RunHuddle's session choice; never force-kill it.
            subprocess.Popen(['/usr/bin/osascript', '-e',
                              'on run argv\n tell application (item 1 of argv) to quit\nend run', str(app)])
            print('Update prepared. Waiting for RunHuddle to close…', flush=True)
            deadline = time.monotonic() + 300
            while is_running():
                if time.monotonic() > deadline:
                    parser.error('RunHuddle is still open. No update was installed.')
                time.sleep(.5)
        if is_running():
            parser.error('RunHuddle reopened before replacement. No update was installed.')
        if app.exists():
            app.rename(backup)
        try:
            stage.rename(app)
        except OSError:
            if backup.exists():
                backup.rename(app)
            raise
    # Refresh Launch Services after replacing the bundle, including its icon.
    # Notification Center and other system surfaces resolve icons through this registration.
    register = Path('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister')
    if register.exists():
        subprocess.run([str(register), '-f', str(app)], check=True)
    if args.copilot_hooks:
        run(app / 'Contents/Resources/python/bin/python3', '-E', '-s', '-B',
            app / 'Contents/Resources/bridge/copilot_bridge.py', 'install-hooks')
    if args.claude_hooks:
        run(app / 'Contents/Resources/python/bin/python3', '-E', '-s', '-B',
            app / 'Contents/Resources/bridge/claude_bridge.py', 'install-hooks')
    print(f'Installed: {app}\nThis app is self-contained; the checkout is no longer needed to run it.')
    if args.open or args.restart:
        environment = os.environ.copy()
        environment.pop('NO_COLOR', None)
        subprocess.run(['/usr/bin/open', str(app)], env=environment, check=True)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(f'Installation stopped: {error.cmd[0]} exited with status {error.returncode}. See the error above.', file=sys.stderr)
        sys.exit(error.returncode or 1)
