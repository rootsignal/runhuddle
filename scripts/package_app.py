"""Package a local development app; its bridge uses the checkout's .venv."""
from pathlib import Path
import plistlib
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
app = root / "dist" / "RunHuddle.app"
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
info = {
    "CFBundleExecutable": "SessionManager", "CFBundleIdentifier": "local.rickbaker.agent-sessions",
    "CFBundleName": "RunHuddle", "CFBundleDisplayName": "RunHuddle",
    "CFBundleIconFile": "RunHuddle",
    "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "0.1.0", "CFBundleVersion": "1",
    "LSMinimumSystemVersion": "14.0", "NSHighResolutionCapable": True,
    "NSAppleEventsUsageDescription": "Find and focus your existing AI session in Terminal or Ghostty, or open a new terminal when requested.",
    "ProjectRoot": str(root),
}
with (contents / "Info.plist").open("wb") as file:
    plistlib.dump(info, file)
subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(app)], check=True)
print(app)
