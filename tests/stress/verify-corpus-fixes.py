#!/usr/bin/env python3
"""Check table order and raw controls after DOCX saves. Run on bbb."""
import argparse
import json
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
ROOT = Path(__file__).resolve().parent
# These generated fixtures test refusal, not DOCX round-trip preservation.
EXPECTED_REFUSALS = {
    'S1-xlsx-named-docx-panics.docx': 'XLSX package with a DOCX extension',
    'S2-pdf-renamed.docx': 'PDF with a DOCX extension',
    'S2-empty.docx': 'empty file',
    'S2-random.docx': 'random bytes',
    'S2-truncated.docx': 'truncated ZIP',
    'S2-encrypted.docx': 'encrypted Office container',
    'S2-password.docx': 'password-protected Office container',
    'S2-password-protected.docx': 'password-protected Office container',
}


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
        reason = EXPECTED_REFUSALS.get(source.name) if source.parent == ROOT / 'samples' else None
        result = {'name': source.name, 'source': str(source), 'mode': args.mode, 'status': 'failed'}
        try:
            if args.officec:
                # A failed attempt must never fall back to a previous save.
                saved.unlink(missing_ok=True)
                p = subprocess.run([str(args.officec.resolve()), 'save', str(source), str(saved)],
                                   capture_output=True, text=True, errors='replace', timeout=90)
                result['cli'] = {'returncode': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}
                if p.returncode != 0:
                    if reason and not saved.exists():
                        result.update(status='expected_refusal', reason=reason)
                    else:
                        result['error'] = 'CLI save failed or left output after refusal'
                elif reason:
                    result['error'] = 'Expected refusal fixture was accepted by CLI'
            if reason:
                result['reason'] = reason
                if not args.officec:
                    result.update(status='skipped_expected_refusal', output_exists=saved.exists())
            elif 'error' not in result:
                if not saved.is_file():
                    result['error'] = 'Missing saved DOCX output'
                else:
                    before, raw_before = snapshot(source)
                    after, raw_after = snapshot(saved)
                    result.update(table_and_row_count=len(before), order_preserved=before == after,
                                  raw_controls_preserved=raw_before == raw_after)
                    result['status'] = 'ok' if before == after and raw_before == raw_after else 'failed'
        except (OSError, subprocess.SubprocessError, BadZipFile, KeyError, ET.ParseError, RuntimeError, ValueError) as e:
            result['error'] = f'{type(e).__name__}: {e}'
        rows.append(result)
        print(json.dumps(result), flush=True)
    (args.results / f'table-order-{args.mode}.json').write_text(json.dumps(rows, indent=2) + '\n')
    checked = sum(r['status'] == 'ok' for r in rows)
    if any(r['status'] == 'failed' for r in rows) or not checked:
        raise SystemExit('DOCX audit failed; see table-order evidence for every source')
    excluded = len(rows) - checked
    print(f'PASS: {checked} DOCX saves; {excluded} expected refusal fixtures reported separately')


if __name__ == '__main__':
    main()
