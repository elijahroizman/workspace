#!/usr/bin/env python3
"""Make scan/password variants of the public-domain IRS W-9, without app code changes.
Run on bbb: uv run --with pypdf --with pillow tests/stress/corpus/derive-pdfs.py
"""
import csv, hashlib, subprocess, tempfile
from pathlib import Path
from PIL import Image
from pypdf import PdfReader, PdfWriter
ROOT = Path(__file__).resolve().parent
raw = Path.home() / 'stress-corpus-files'
source = raw / 'irs-fw9.pdf'
writer = PdfWriter(clone_from=source)
writer.encrypt('corpus', algorithm='RC4-128')
password = ROOT / 'files/irs-fw9-password.pdf'
writer.write(password)
scan = ROOT / 'files/irs-fw9-scanned-page1.pdf'
with tempfile.TemporaryDirectory(prefix='corpus-scan-') as temp:
    prefix = Path(temp) / 'page'
    subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-r', '120', '-png', str(source), str(prefix)], check=True)
    with Image.open(str(prefix) + '.png') as image:
        image.convert('RGB').save(scan, 'PDF', resolution=120)
rows = list(csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t'))
rows = [r for r in rows if r['file'] not in {scan.name, password.name}]
for path in [scan, password]:
    data = path.read_bytes()
    (raw / path.name).write_bytes(data)
    rows.append(dict(file=path.name, source_url='generated:' + path.name, sha256=hashlib.sha256(data).hexdigest(),
        redistribution_note='Generated derivative of US federal IRS W-9, https://www.irs.gov/pub/irs-pdf/fw9.pdf; federal text public domain; password corpus', category='derivative', bytes=len(data)))
with (ROOT / 'manifest.tsv').open('w') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]), delimiter='\t', lineterminator='\n')
    w.writeheader(); w.writerows(sorted(rows, key=lambda r: r['file']))
