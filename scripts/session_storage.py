"""Cheap metadata-only measurement of an agent's primary transcript file."""
from pathlib import Path
import stat
import time


def transcript_storage(path):
    if not path:
        return None
    try:
        info = Path(path).stat()
        if not stat.S_ISREG(info.st_mode):
            return None
        return {'bytes': info.st_size, 'allocatedBytes': info.st_blocks * 512,
                'fileID': f'{info.st_dev}:{info.st_ino}', 'checkedAt': time.time()}
    except (OSError, ValueError):
        return None
