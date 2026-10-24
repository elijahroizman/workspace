#!/usr/bin/env python3
"""Compare Poppler's cryptographic signature validation before and after saving."""
import argparse
import csv
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest_statuses(output):
    """Keep each signature's digest result separate from certificate trust."""
    statuses = {}
    for number, block in re.findall(r'^Signature #(\d+):\s*\n(.*?)(?=^Signature #|\Z)', output, re.M | re.S):
        match = re.search(r'^\s*- Signature Validation:\s*(.+?)\s*$', block, re.M)
        statuses[number] = match[1] if match else None
    return statuses


def inspect(path, allow_unsigned=False):
    pw = ['-upw', 'corpus'] if path.name == 'irs-fw9-password.pdf' else []
    p = subprocess.run(['pdfsig', *pw, str(path)], capture_output=True, text=True, timeout=30)
    if allow_unsigned and p.returncode == 2 and 'does not contain any signatures' in p.stdout and not digest_statuses(p.stdout):
        return p.stdout
    if p.returncode:
        raise subprocess.CalledProcessError(p.returncode, p.args, output=p.stdout, stderr=p.stderr)
    return p.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', type=Path, default=Path.home() / 'stress-corpus-files')
    ap.add_argument('--results', type=Path, default=ROOT / 'results')
    args = ap.parse_args()
    results = []
    failed = False
    with (ROOT / 'manifest.tsv').open() as manifest:
        rows = list(csv.DictReader(manifest, delimiter='\t'))
    for row in rows:
        name = row['file']
        if not name.endswith('.pdf'):
            continue
        record = {'name': name, 'saves': {}, 'errors': {}}
        try:
            record['original'] = inspect(args.files / name, allow_unsigned=True)
            required = digest_statuses(record['original'])
            if not required:
                continue
            if any(status is None for status in required.values()):
                raise ValueError('Original signature has no digest validation result')
        except (OSError, subprocess.SubprocessError, ValueError, RuntimeError) as e:
            if isinstance(e, subprocess.CalledProcessError):
                record['original'] = e.stdout
                record['original_stderr'] = e.stderr
            record['errors']['original'] = str(e)
        else:
            record['required_digest_statuses'] = required
            for browser in ('chromium', 'webkit'):
                saved = args.results / browser / name
                try:
                    if not saved.is_file():
                        raise FileNotFoundError(f'Missing saved PDF: {saved}')
                    record['saves'][browser] = inspect(saved)
                    actual = digest_statuses(record['saves'][browser])
                    if actual != required:
                        raise ValueError(f'Signature digest results changed: required {required}, saved {actual}')
                except (OSError, subprocess.SubprocessError, ValueError, RuntimeError) as e:
                    if isinstance(e, subprocess.CalledProcessError):
                        record['saves'][browser] = e.stdout
                        record.setdefault('save_stderr', {})[browser] = e.stderr
                    record['errors'][browser] = str(e)
        record['status'] = 'failed' if record['errors'] else 'ok'
        failed |= bool(record['errors'])
        results.append(record)
        print(json.dumps(record), flush=True)
    args.results.mkdir(parents=True, exist_ok=True)
    (args.results / 'signatures.json').write_text(json.dumps(results, indent=2) + '\n')
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
