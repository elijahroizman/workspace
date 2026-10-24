#!/usr/bin/env python3
"""Check the Linux launcher's multiple-file arguments with GIO and a harmless recorder."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

if not shutil.which('gio'):
    raise SystemExit('GIO is required for this Linux desktop integration check')
source = Path(__file__).resolve().parents[3] / 'src-tauri/linux/main.desktop'
exec_line = next(line for line in source.read_text().splitlines() if line.startswith('Exec='))
assert '%F' in exec_line, 'launcher must declare multiple-file arguments'
with tempfile.TemporaryDirectory(prefix='writan-desktop-') as folder:
    root = Path(folder)
    output = root / 'arguments.json'
    recorder = root / 'record-open'
    recorder.write_text(f'#!{sys.executable}\nimport json, sys\nfrom pathlib import Path\nPath({str(output)!r}).write_text(json.dumps(sys.argv[1:]))\n')
    recorder.chmod(0o700)
    desktop = root / 'writan-test.desktop'
    desktop.write_text('[Desktop Entry]\nType=Application\nName=Writan argument test\n' + exec_line.replace('{{exec}}', str(recorder)) + '\n')
    files = [root / 'one document.md', root / '文件.md']
    for file in files:
        file.write_text('Reproducible launcher sample.\n')
    subprocess.run(['gio', 'launch', str(desktop), *map(str, files)], check=True, timeout=10)
    for _ in range(100):
        try:
            received = json.loads(output.read_text())
            break
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.02)
    else:
        raise AssertionError('launcher did not forward file arguments')
    assert received == list(map(str, files)), received
print('desktop-open: two paths, including spaces and Unicode, forwarded together')
