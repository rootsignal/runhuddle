"""Bundle a pinned relocatable Python; only the builder needs developer tools."""
import hashlib
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request

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
        urllib.request.urlretrieve(f'https://github.com/astral-sh/python-build-standalone/releases/download/{RELEASE}/{name}', archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise RuntimeError('Bundled Python checksum mismatch')
    with tarfile.open(archive) as tar:
        tar.extractall(destination, filter='data')
    runtime = destination / 'python'
    python = runtime / 'bin/python3'
    subprocess.run([str(python), '-E', '-s', '-B', '-m', 'pip', 'install', '--no-compile', '--only-binary=:all:',
                    '--disable-pip-version-check', '-r', str(root / 'scripts/requirements.txt')], check=True)
    notices = destination / 'ThirdPartyNotices'
    notices.mkdir(exist_ok=True)
    for name in LICENSES:
        cached = cache / name
        if not cached.exists():
            urllib.request.urlretrieve(f'https://raw.githubusercontent.com/astral-sh/python-build-standalone/{RELEASE}/{name}', cached)
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
                subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(path)], check=True, capture_output=True)
