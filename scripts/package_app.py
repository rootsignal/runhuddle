"""Package the standalone RunHuddle app with its private Python runtime."""
from pathlib import Path
import plistlib
import os
import shutil
import subprocess
import tempfile
from bundle_runtime import bundle, sign_nested

root = Path(__file__).resolve().parents[1]
build_folder = tempfile.TemporaryDirectory(prefix="runhuddle-package-", dir=root / ".build")
app = Path(build_folder.name) / "RunHuddle.app"
contents = app / "Contents"
(contents / "MacOS").mkdir(parents=True, exist_ok=True)
shutil.copy2(root / ".build/release/SessionManager", contents / "MacOS/SessionManager")
resources = contents / "Resources"
resources.mkdir(parents=True, exist_ok=True)
iconset = root / ".build/RunHuddle.iconset"
generator = root / ".build/generate-runhuddle-icon"
subprocess.run(["swiftc", str(root / "Sources/SessionManager/RunHuddleIcon.swift"),
                str(root / "scripts/icon/main.swift"), "-o", str(generator)], check=True)
subprocess.run([str(generator), str(iconset)], check=True)
subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(resources / "RunHuddle.icns")], check=True)
bridge = resources / "bridge"
bridge.mkdir()
for name in ("codex_bridge.py", "codex_events.py", "handoff_ai.py", "copilot_bridge.py", "claude_bridge.py", "local_cleanup.py", "context_usage.py", "history_search.py"):
    shutil.copy2(root / "scripts" / name, bridge / name)
sparkle = root / '.build/artifacts/sparkle/Sparkle'
frameworks = contents / 'Frameworks'
frameworks.mkdir()
framework = frameworks / 'Sparkle.framework'
shutil.copytree(sparkle / 'Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework', framework, symlinks=True)
runtime = bundle(root, resources)
shutil.copy2(sparkle / 'LICENSE', resources / 'ThirdPartyNotices/Sparkle-LICENSE.txt')
sign_nested(runtime)
info = {
    "CFBundleExecutable": "SessionManager", "CFBundleIdentifier": "local.rickbaker.agent-sessions",
    "CFBundleName": "RunHuddle", "CFBundleDisplayName": "RunHuddle",
    "CFBundleIconFile": "RunHuddle",
    "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.6.0", "CFBundleVersion": "13",
    "SUFeedURL": "https://raw.githubusercontent.com/rootsignal/runhuddle/main/updates/appcast.xml",
    "SUPublicEDKey": (root / 'config/sparkle-public-key.txt').read_text().strip(),
    "SURequireSignedFeed": True,
    "SUVerifyUpdateBeforeExtraction": True,
    "SUEnableAutomaticChecks": False,
    "SUAutomaticallyUpdate": False,
    "LSMinimumSystemVersion": "14.0", "NSHighResolutionCapable": True,
    "NSAppleEventsUsageDescription": "Find and focus your existing AI session in Terminal or Ghostty, or open a new terminal when requested.",
}
with (contents / "Info.plist").open("wb") as file:
    plistlib.dump(info, file)
identity = os.environ.get("RUNHUDDLE_SIGN_IDENTITY", "-")
flags = ["--options", "runtime", "--timestamp", "--entitlements", str(root / "scripts/entitlements.plist")] if identity != "-" else []
# Sign Sparkle from the inside out, preserving its helper entitlements.
sparkle_flags = ["--options", "runtime", "--timestamp"] if identity != "-" else []
versioned = framework / 'Versions/B'
for target in [*sorted((versioned / 'XPCServices').glob('*.xpc')), versioned / 'Updater.app', versioned / 'Autoupdate', framework]:
    subprocess.run(["/usr/bin/codesign", "--force", "--sign", identity, "--preserve-metadata=entitlements", *sparkle_flags, str(target)], check=True)
subprocess.run(["/usr/bin/codesign", "--force", "--sign", identity, *flags, str(app)], check=True)
subprocess.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)], check=True)
final = root / "dist/RunHuddle.app"
final.parent.mkdir(exist_ok=True)
if final.exists():
    shutil.rmtree(final)
shutil.move(str(app), str(final))
build_folder.cleanup()
print(final)
