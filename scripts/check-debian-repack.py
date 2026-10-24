#!/usr/bin/env python3
"""Exercise the release workflow's Debian repack without installing a package."""
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import textwrap

root = Path(__file__).resolve().parents[1]
workflow = (root / '.github/workflows/release.yml').read_text()
start = workflow.index('          work="$(mktemp -d)"')
end = workflow.index('          tag=', start)
repack = textwrap.dedent(workflow[start:end])
with tempfile.TemporaryDirectory(prefix='writan-deb-repack-') as folder:
    base = Path(folder)
    tree = base / 'package'
    (tree / 'DEBIAN').mkdir(parents=True)
    (tree / 'DEBIAN/control').write_text('Package: writan\nVersion: 0.10.5\nArchitecture: amd64\nMaintainer: Test <test@example.com>\nReplaces: workspace\nDescription: Repack regression fixture\n')
    for name in ['usr/bin/writan', 'usr/share/keyrings/writan-archive-keyring.gpg']:
        path = tree / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'fixture\n')
    deb = base / 'Writan_0.10.5_amd64.deb'
    subprocess.run(['dpkg-deb', '--root-owner-group', '--build', str(tree), str(deb)], check=True, capture_output=True)
    env = dict(os.environ, deb_path=str(deb), version='0.10.5')
    subprocess.run(['bash', '-euo', 'pipefail', '-c', repack], env=env, check=True)
    data = subprocess.check_output(['dpkg-deb', '--fsys-tarfile', str(deb)])
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        entries = archive.getmembers()
        assert entries and all(m.uid == 0 and m.gid == 0 for m in entries)
        assert archive.getmember('./usr/bin/writan').uid == 0
        assert archive.getmember('./usr/share/keyrings/writan-archive-keyring.gpg').uid == 0
    assert subprocess.check_output(['dpkg-deb', '-f', str(deb), 'Breaks'], text=True).strip() == 'workspace (<< 0.10.5)'
print('Debian release repack preserves root ownership and the versioned migration break')
