"""Package tmux and its non-system dylibs; no Homebrew dependency on users' Macs."""
from pathlib import Path
import os
import shutil
import subprocess


def bundle_terminal(resources):
    source = Path(os.environ.get('RUNHUDDLE_TMUX', shutil.which('tmux') or '/nonexistent')).resolve()
    if not source.is_file():
        raise RuntimeError('Install tmux on the build machine (brew install tmux).')
    if subprocess.check_output([str(source), '-V'], text=True).strip() != 'tmux 3.5a':
        raise RuntimeError('Terminal protocol is pinned to tmux 3.5a. Review running-server compatibility before changing it.')
    runtime = resources / 'terminal-runtime'
    (runtime / 'bin').mkdir(parents=True)
    (runtime / 'lib').mkdir()
    notices = resources / 'ThirdPartyNotices'
    notices.mkdir(exist_ok=True)
    copied = {}
    def copy_binary(original, destination):
        original = original.resolve()
        if original in copied:
            return copied[original]
        copied[original] = destination
        shutil.copy2(original, destination)
        destination.chmod(0o755)
        lines = subprocess.check_output(['otool', '-L', str(original)], text=True).splitlines()[1:]
        own_ids = subprocess.run(['otool', '-D', str(original)], capture_output=True, text=True).stdout.splitlines()[1:]
        for line in lines:
            if '(compatibility version ' not in line:
                continue
            dependency = line.strip().split(' (')[0]
            if dependency in own_ids or dependency.startswith(('/usr/lib/', '/System/Library/')):
                continue
            if not dependency.startswith('/'):
                raise RuntimeError('Unsupported dependency: ' + dependency)
            lib = copy_binary(Path(dependency), runtime / 'lib' / Path(dependency).name)
            relative = os.path.relpath(lib, destination.parent)
            subprocess.run(['install_name_tool', '-change', dependency, '@loader_path/' + relative, str(destination)], check=True)
        if destination.suffix == '.dylib':
            subprocess.run(['install_name_tool', '-id', '@loader_path/' + destination.name, str(destination)], check=True)
        # Homebrew formula installation retains upstream notices beside bin/lib.
        root = original.parent.parent
        for name in ['COPYING', 'LICENSE', 'LICENSE.md']:
            if (root / name).exists():
                shutil.copy2(root / name, notices / ('terminal-' + root.parent.name + '-' + name))
        return destination
    copy_binary(source, runtime / 'bin/tmux')
    terminfo = Path('/opt/homebrew/opt/ncurses/share/terminfo')
    if not terminfo.exists():
        terminfo = Path('/usr/local/opt/ncurses/share/terminfo')
    for name in ['xterm-256color', 'screen-256color', 'tmux-256color']:
        matches = list(terminfo.glob('*/' + name))
        if not matches:
            raise RuntimeError('Missing bundled terminal description: ' + name)
        destination = runtime / 'share/terminfo' / matches[0].parent.name / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(matches[0], destination)
    version = subprocess.check_output([str(source), '-V'], text=True).strip()
    (runtime / 'VERSION').write_text(version + '\n')
    return runtime
