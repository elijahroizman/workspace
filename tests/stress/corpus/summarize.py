#!/usr/bin/env python3
"""Commit compact evidence without public document bodies or screenshots."""
import collections, csv, json, statistics
from pathlib import Path
ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / 'results'

def read(name, default=None):
    p = RESULTS / name
    return json.loads(p.read_text()) if p.exists() else default

def main():
    rows = list(csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t'))
    manifest = {x['file']: x for x in rows}
    evidence = {'date': '2026-10-24', 'baseline_commit': 'b088f996153b1a639dedcd9ca5119ee050e892e5', 'host': 'bbb, Ubuntu 26.04.1, Node 24, LibreOffice 26.2.6.3', 'files': len(rows),
        'categories': dict(collections.Counter(r['category'] for r in rows)), 'formats': {}, 'browser': [],
        'structure': read('structure.json', []), 'values': read('values.json', []), 'pdf': read('pdf-audit.json', []), 'signatures': read('signatures.json', []), 'verification': read('verification.json', []), 'references': []}
    # All browser rounds are keyed by filename so retries do not inflate pass counts.
    for browser in ['chromium', 'webkit']:
        p = RESULTS / ('browser-' + browser + '.jsonl')
        latest = {x['name']: x for x in map(json.loads, p.read_text().splitlines())}
        for name, x in latest.items():
            if name not in manifest: continue
            evidence['browser'].append({k: x[k] for k in ['name', 'browser', 'status', 'openMs', 'totalMs', 'consoleErrors', 'pageErrors', 'timingLogs', 'error'] if k in x} | {'heap': x.get('dom', {}).get('heap')})
    for fmt in sorted({Path(x).suffix[1:] for x in manifest}):
        names = [n for n in manifest if n.endswith('.' + fmt)]
        info = {'files': len(names)}
        for browser in ['chromium', 'webkit']:
            runs = [x for x in evidence['browser'] if x['name'] in names and x['browser'] == browser]
            times = [x['openMs'] for x in runs if 'openMs' in x]
            info[browser] = {'tested': len(runs), 'opened_and_saved': sum(x['status'] == 'ok' for x in runs),
                'page_errors': sum(bool(x['pageErrors']) for x in runs), 'console_errors': sum(bool(x['consoleErrors']) for x in runs),
                'median_open_ms': round(statistics.median(times)) if times else None, 'max_open_ms': max(times) if times else None}
        cli = [x for x in evidence['structure'] if x['name'] in names]
        info['cli'] = {'tested': len(cli), 'save_ok': sum(x.get('cli', {}).get('returncode') == 0 for x in cli)}
        for mode in ['cli', 'chromium', 'webkit']:
            checks = [x[mode].get('diff', x[mode]) for x in cli if mode in x]
            def intact(d):
                if 'byte_identical' in d: return d['byte_identical']
                return not d.get('changed') and not d.get('added') and not [n for n in d.get('removed', []) if not n.endswith('/')]
            info[mode + '_parts_unchanged'] = {'tested': len(checks), 'passed': sum(intact(d) for d in checks)}
        evidence['formats'][fmt] = info
    for r in read('references.json', []):
        evidence['references'].append({k: r[k] for k in ['name', 'mode', 'status', 'pages', 'text_bytes', 'text_sha256', 'error'] if k in r})
    for entry in evidence['verification']:
        entry.get('engine', {}).pop('text', None)
    out = ROOT / 'evidence/2026-10-24.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(evidence['formats'], indent=2))

if __name__ == '__main__': main()
