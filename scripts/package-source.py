"""Archive tracked release sources and exact Swift package dependencies, never local credentials."""
from pathlib import Path
import hashlib
import json
import subprocess
import tarfile
import tempfile
import plistlib

root = Path(__file__).resolve().parents[1]
with (root / 'dist/RunHuddle.app/Contents/Info.plist').open('rb') as f:
    version = plistlib.load(f)['CFBundleShortVersionString']
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
with tempfile.TemporaryDirectory(prefix='runhuddle-source-') as work:
    work = Path(work)
    prefix = f'RunHuddle-{version}-source'
    result = root / 'dist' / f'RunHuddle-{version}-source.tar.gz'
    # Merge git-produced tar members directly; no filesystem checkout or ignored files.
    with tarfile.open(result, 'w:gz') as output:
        sources = [(root, commit, prefix + '/')]
        for pin in json.loads((root / 'Package.resolved').read_text())['pins']:
            checkout = next(p for p in (root / '.build/checkouts').iterdir() if p.name.lower() == pin['identity'])
            sources.append((checkout, pin['state']['revision'], prefix + '/dependency-sources/' + pin['identity'] + '/'))
        for index, (repo, revision, member_prefix) in enumerate(sources):
            archive = work / f'{index}.tar'
            subprocess.run(['git', 'archive', '--format=tar', '--prefix=' + member_prefix, '-o', str(archive), revision], cwd=repo, check=True)
            with tarfile.open(archive) as source:
                for member in source:
                    output.addfile(member, source.extractfile(member) if member.isfile() else None)
    digest = hashlib.sha256(result.read_bytes()).hexdigest()
    result.with_suffix(result.suffix + '.sha256').write_text(f'{digest}  {result.name}\n')
    print(result)
