#!/usr/bin/env python3
"""Check table sibling order and raw controls after DOCX saves. Run on bbb."""
import argparse
import json
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ROOT = Path(__file__).resolve().parent


def snapshot(path):
    with ZipFile(path) as z:
        root = ET.fromstring(z.read('word/document.xml'))
    order = []
    controls = []
    for parent in root.iter():
        if parent.tag not in (W + 'tbl', W + 'tr'):
            continue
        order.append([c.tag for c in parent if c.tag not in {W + 'tblPr', W + 'tblGrid', W + 'trPr', W + 'tblPrEx'}])
        controls.extend(ET.tostring(c, encoding='unicode') for c in parent if c.tag == W + 'sdt')
    return order, controls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', type=Path, default=Path.home() / 'stress-corpus-files')
    ap.add_argument('--results', type=Path, default=ROOT / 'corpus' / 'results-fixes')
    ap.add_argument('--mode', default='cli', choices=['cli', 'chromium', 'webkit'])
    ap.add_argument('--officec', type=Path, help='Save each source with this CLI before checking')
    args = ap.parse_args()
    dest = args.results / args.mode
    dest.mkdir(parents=True, exist_ok=True)
    sources = sorted(args.files.glob('*.docx')) + sorted((ROOT / 'samples').glob('*.docx'))
    rows = []
    for source in sources:
        saved = dest / source.name
        if args.officec:
            subprocess.run([str(args.officec.resolve()), 'save', str(source), str(saved)], check=True, capture_output=True)
        if not saved.exists():
            continue
        before, raw_before = snapshot(source)
        after, raw_after = snapshot(saved)
        result = {'name': source.name, 'mode': args.mode, 'table_and_row_count': len(before),
                  'order_preserved': before == after, 'raw_controls_preserved': raw_before == raw_after}
        rows.append(result)
        print(json.dumps(result), flush=True)
    if not rows:
        raise SystemExit('No saved DOCX files checked')
    (args.results / f'table-order-{args.mode}.json').write_text(json.dumps(rows, indent=2) + '\n')
    if not all(r['order_preserved'] and r['raw_controls_preserved'] for r in rows):
        raise SystemExit('Table sibling order or raw controls changed')
    print(f'PASS: {len(rows)} DOCX saves; table/row order and raw controls preserved')


if __name__ == '__main__':
    main()
