"""Bundle a pinned relocatable Python; only the builder needs developer tools."""
import hashlib
import os
import json
import re
import tempfile
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile

RELEASE = '20261026'
VERSION = '3.13.18'
RUNTIMES = {
    'arm64': ('aarch64', '8392b6ea51d94391befb2c31ebe75463f045d0b69dfcf5e1bb3234e1f5fa3405'),
    'x86_64': ('x86_64', '7412c19d896c99431b74a18a5643e110449a7f9590fbab179c3e5ab27b9aa9e3'),
}
LICENSES = ['LICENSE', 'LICENSE.bdb.txt', 'LICENSE.bzip2.txt', 'LICENSE.cpython.txt', 'LICENSE.expat.txt',
            'LICENSE.libX11.txt', 'LICENSE.libXau.txt', 'LICENSE.libedit.txt', 'LICENSE.libffi.txt',
            'LICENSE.liblzma.txt', 'LICENSE.libuuid.txt', 'LICENSE.libxcb.txt', 'LICENSE.mpdecimal.txt',
            'LICENSE.ncurses.txt', 'LICENSE.openssl-3.txt', 'LICENSE.sqlite.txt', 'LICENSE.tcl.txt',
            'LICENSE.tix.txt', 'LICENSE.zlib-ng.txt', 'LICENSE.zlib.txt', 'LICENSE.zstd.txt', 'python-licenses.rst']


def download(url, destination, expected=None):
    """Use macOS TLS trust, validate optional digest, and never leave partial cache entries."""
    if not url.startswith('https://'):
        raise ValueError('Downloads require HTTPS')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as file:
        partial = Path(file.name)
    try:
        subprocess.run(['/usr/bin/curl', '--disable', '--fail', '--show-error', '--silent', '--location',
                        '--proto', '=https', '--proto-redir', '=https', '--retry', '2',
                        '--connect-timeout', '20', '--max-time', '180', '--output', str(partial), url], check=True)
        if expected and hashlib.sha256(partial.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Download checksum mismatch: ' + destination.name)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)


def install_dependencies(python, requirements, cache):
    # Select wheels for the bundled interpreter, not the builder's Python/version/ABI.
    selector = """
import json, sys
from pip._vendor.packaging.tags import sys_tags
from pip._vendor.packaging.utils import parse_wheel_filename
ranks = {tag: index for index, tag in enumerate(sys_tags())}
choices = []
for filename in json.load(sys.stdin):
    tags = parse_wheel_filename(filename)[3]
    rank = min((ranks[t] for t in tags if t in ranks), default=None)
    if rank is not None:
        choices.append((rank, filename))
if not choices:
    raise SystemExit('No compatible prebuilt dependency wheel for bundled Python')
print(min(choices)[1])
"""
    wheels = []
    for line in requirements.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)', line)
        if not match:
            raise ValueError('Build dependencies must use exact version pins: ' + line)
        name, version = match.groups()
        metadata = cache / f'{name}-{version}.json'
        download(f'https://pypi.org/pypi/{name}/{version}/json', metadata)
        entries = {item['filename']: item for item in json.loads(metadata.read_text())['urls']
                   if item.get('packagetype') == 'bdist_wheel' and not item.get('yanked')}
        selected = subprocess.run([str(python), '-E', '-s', '-B', '-c', selector],
                                  input=json.dumps(list(entries)), text=True, capture_output=True, check=True).stdout.strip()
        entry = entries[selected]
        if Path(selected).name != selected or not entry['url'].startswith('https://files.pythonhosted.org/'):
            raise ValueError('Unexpected dependency download location')
        expected = entry['digests']['sha256']
        wheel = cache / selected
        if not wheel.exists() or hashlib.sha256(wheel.read_bytes()).hexdigest() != expected:
            download(entry['url'], wheel, expected)
        wheels.append(str(wheel))
    subprocess.run([str(python), '-E', '-s', '-B', '-m', 'pip', '--isolated', 'install',
                    '--no-index', '--no-deps', '--no-compile', '--disable-pip-version-check', *wheels], check=True)


def bundle(root, destination):
    arch = platform.machine()
    if arch not in RUNTIMES:
        raise RuntimeError('Unsupported build architecture: ' + arch)
    target, expected = RUNTIMES[arch]
    cache = root / '.build/runtime-cache'
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f'python-{arch}.tar.gz'
    name = f'cpython-{VERSION}%2B{RELEASE}-{target}-apple-darwin-install_only_stripped.tar.gz'
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        download(f'https://github.com/astral-sh/python-build-standalone/releases/download/{RELEASE}/{name}', archive, expected)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise RuntimeError('Bundled Python checksum mismatch')
    with tarfile.open(archive) as tar:
        tar.extractall(destination, filter='data')
    runtime = destination / 'python'
    python = runtime / 'bin/python3'
    install_dependencies(python, root / 'scripts/requirements.txt', cache / 'wheels')
    notices = destination / 'ThirdPartyNotices'
    notices.mkdir(exist_ok=True)
    for name in LICENSES:
        cached = cache / name
        if not cached.exists():
            download(f'https://raw.githubusercontent.com/astral-sh/python-build-standalone/{RELEASE}/{name}', cached)
        shutil.copy2(cached, notices / name)
    (notices / 'README.txt').write_text(
        f'RunHuddle includes Python {VERSION} from astral-sh/python-build-standalone release {RELEASE}.\n'
        'Upstream Python and dependency license notices are retained here. Some upstream components may not be used.\n'
        'websockets and PyYAML license notices are also retained in python/lib/python3.13/site-packages/*.dist-info/.\n')
    # Avoid later bytecode generation changing the signature. The bridge and hooks use -B.
    for folder in runtime.rglob('__pycache__'):
        shutil.rmtree(folder)
    return runtime


def sign_nested(runtime):
    magic = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'}
    for path in sorted(runtime.rglob('*')):
        if path.is_file() and not path.is_symlink():
            with path.open('rb') as file:
                is_code = file.read(4) in magic
            if is_code:
                identity = os.environ.get('RUNHUDDLE_SIGN_IDENTITY', '-')
                flags = ['--options', 'runtime', '--timestamp'] if identity != '-' else []
                subprocess.run(['/usr/bin/codesign', '--force', '--sign', identity, *flags, str(path)], check=True, capture_output=True)
