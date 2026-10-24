#!/usr/bin/env python3
"""Compare Poppler's cryptographic signature validation before and after saving."""
import csv, json, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent
results = []
for row in csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t'):
    name = row['file']
    if not name.endswith('.pdf'): continue
    source = Path.home() / 'stress-corpus-files' / name
    original = subprocess.run(['pdfsig', str(source)], capture_output=True, text=True, timeout=30)
    if 'Signature #1' not in original.stdout: continue
    record = {'name': name, 'original': original.stdout, 'saves': {}}
    for browser in ['chromium', 'webkit']:
        saved = ROOT / 'results' / browser / name
        if saved.exists():
            p = subprocess.run(['pdfsig', str(saved)], capture_output=True, text=True, timeout=30)
            record['saves'][browser] = p.stdout
    results.append(record)
(ROOT / 'results/signatures.json').write_text(json.dumps(results, indent=2) + '\n')
for r in results:
    print(r['name'], r['original'], r['saves'])
