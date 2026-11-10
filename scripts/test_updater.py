"""Opt-in integration test using a separate signed fixture, never user session data."""
import functools
import http.server
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = os.environ['RUNHUDDLE_SIGN_IDENTITY']
TOOLS = ROOT / '.build/artifacts/sparkle/Sparkle/bin'
FRAMEWORK = ROOT / 'dist/RunHuddle.app/Contents/Frameworks/Sparkle.framework'

def run(*args):
    return subprocess.run(list(map(str, args)), check=True, capture_output=True, text=True).stdout

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

with tempfile.TemporaryDirectory(prefix='updater-smoke-', dir=ROOT / '.build') as directory:
    root = Path(directory)
    server_dir = root / 'server'
    server_dir.mkdir()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(server_dir)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    try:
        binary = root / 'UpdaterSmoke'
        run('clang', '-fobjc-arc', '-framework', 'Cocoa', '-framework', 'Sparkle', '-F' + str(FRAMEWORK.parent),
            '-Wl,-rpath,@executable_path/../Frameworks', ROOT / 'Tests/UpdaterSmoke/main.m', '-o', binary)
        def make_app(parent, version):
            app = parent / 'UpdaterSmoke.app'
            (app / 'Contents/MacOS').mkdir(parents=True)
            shutil.copy2(binary, app / 'Contents/MacOS/UpdaterSmoke')
            shutil.copytree(FRAMEWORK, app / 'Contents/Frameworks/Sparkle.framework', symlinks=True)
            info = dict(CFBundleIdentifier='io.rootsignal.runhuddle.updater-smoke', CFBundleExecutable='UpdaterSmoke',
                        CFBundleName='UpdaterSmoke', CFBundlePackageType='APPL', CFBundleVersion=version,
                        CFBundleShortVersionString='1.' + version, LSMinimumSystemVersion='14.0',
                        SUFeedURL=base + 'appcast.xml', SUPublicEDKey=(ROOT / 'config/sparkle-public-key.txt').read_text().strip(),
                        SURequireSignedFeed=True, SUVerifyUpdateBeforeExtraction=True, SUEnableAutomaticChecks=False,
                        SUAutomaticallyUpdate=False, NSAppTransportSecurity={'NSAllowsLocalNetworking': True, 'NSAllowsArbitraryLoads': True})
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
            run('codesign', '--force', '--sign', IDENTITY, '--options', 'runtime', '--timestamp', app)
            return app
        new = make_app(root / 'target', '2')
        run('ditto', '-c', '-k', '--keepParent', new, server_dir / 'Update.zip')
        run(TOOLS / 'generate_appcast', '--account', 'RunHuddle', '--maximum-deltas', '0', '--download-url-prefix', base, server_dir)
        feed = server_dir / 'appcast.xml'
        original = feed.read_bytes()
        old = make_app(root / 'installed', '1')
        executable = old / 'Contents/MacOS/UpdaterSmoke'
        # A modified signed feed must not reach installation.
        feed.write_bytes(original.replace(b'<title>', b'<title>TAMPERED ', 1))
        result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=45)
        assert result.returncode == 4, result.stderr
        assert 'signature' in result.stderr.lower(), result.stderr
        assert plistlib.loads((old / 'Contents/Info.plist').read_bytes())['CFBundleVersion'] == '1'
        print('Tampered feed rejected; installed version unchanged.', flush=True)
        feed.write_bytes(original)
        log_path = ROOT / '.build/updater-smoke.log'
        with log_path.open('w') as log:
            process = subprocess.Popen([str(executable)], stdout=log, stderr=log)
            marker = old.parent / 'relaunched.txt'
            try:
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline and not marker.exists():
                    if process.poll() not in (None, 0):
                        raise AssertionError(log_path.read_text())
                    time.sleep(.25)
                assert marker.exists(), log_path.read_text()
                assert plistlib.loads((old / 'Contents/Info.plist').read_bytes())['CFBundleVersion'] == '2'
                run('codesign', '--verify', '--deep', '--strict', old)
                print('Signed update downloaded, installed in place, and relaunched successfully.', flush=True)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
    finally:
        server.shutdown()
