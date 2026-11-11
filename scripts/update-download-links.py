#!/usr/bin/env python3
"""Point installation docs at the release advertised by the verified update feed."""
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
START = '<!-- current-download:start -->'
END = '<!-- current-download:end -->'


def update(feed: Path):
    item = ET.parse(feed).getroot().find('./channel/item')
    if item is None:
        raise ValueError('Feed has no release')
    version = item.findtext('{http://www.andymatuschak.org/xml-namespaces/sparkle}shortVersionString')
    if not version or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid release version')
    release = f'https://github.com/rootsignal/runhuddle/releases/tag/v{version}'
    expected = f'https://github.com/rootsignal/runhuddle/releases/download/v{version}/RunHuddle-{version}-arm64.dmg'
    enclosure = item.find('enclosure')
    if enclosure is None or enclosure.get('url') != expected:
        raise ValueError('Unexpected installer URL')
    changes = []
    for relative in ['README.md', 'docs/GETTING_STARTED.md']:
        path = ROOT / relative
        content = path.read_text()
        if content.count(START) != 1 or content.count(END) != 1:
            raise ValueError(f'Missing or duplicate download markers: {relative}')
        block = f'{START}\n**[Download RunHuddle {version} for Apple Silicon]({expected})**\n\n[Release notes]({release}) · [All releases](https://github.com/rootsignal/runhuddle/releases)\n{END}'
        updated = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda _: block, content, flags=re.S)
        changes.append((path, updated))
    for path, content in changes:
        path.write_text(content)


if __name__ == '__main__':
    update(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'updates/appcast.xml')
