#!/usr/bin/env python3
"""CLI round trips and ZIP-part/feature inventories for both CLI and actual app saves."""
import argparse, collections, concurrent.futures, csv, difflib, hashlib, json, re, subprocess, time, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
FEATURES = {
    'comments': {'comment'}, 'tracked_changes': {'ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange'},
    'footnotes': {'footnote'}, 'endnotes': {'endnote'}, 'fields': {'fldChar', 'fldSimple', 'instrText'},
    'smartart': {'relIds', 'dataModel'}, 'charts': {'chart', 'chartSpace'}, 'equations': {'oMath', 'oMathPara'},
    'embedded_fonts': {'embedRegular', 'embedBold', 'embedItalic', 'embeddedFont'},
    'ole': {'OLEObject', 'oleObj'}, 'content_controls': {'sdt'}, 'data_validation': {'dataValidation'},
    'conditional_formatting': {'conditionalFormatting'}, 'defined_names': {'definedName'},
    'images': {'blip', 'imagedata'}, 'formulas': {'f'}, 'merges': {'mergeCell'},
}

def inventory(path):
    if not zipfile.is_zipfile(path):
        return {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    features = collections.Counter()
    texts = []
    with zipfile.ZipFile(path) as z:
        parts = {n: hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}
        for n in parts:
            if n.startswith('customXml/') and n.endswith('.xml'): features['custom_xml_parts'] += 1
            if n.endswith('.xml') or n.endswith('.rels'):
                try:
                    tree = ET.fromstring(z.read(n))
                    for el in tree.iter():
                        tag = el.tag.rsplit('}', 1)[-1]
                        for feature, tags in FEATURES.items():
                            if tag in tags: features[feature] += 1
                        if tag in {'t', 'instrText'} and el.text: texts.append(el.text)
                except ET.ParseError:
                    features['invalid_xml_parts'] += 1
        return {'parts': parts, 'features': dict(features), 'text_chars': sum(map(len, texts))}

def difference(a, b):
    ia, ib = inventory(a), inventory(b)
    if 'parts' not in ia or 'parts' not in ib:
        return {'byte_identical': a.read_bytes() == b.read_bytes(), 'before': ia, 'after': ib}
    pa, pb = ia.pop('parts'), ib.pop('parts')
    changed = [n for n in pa.keys() & pb.keys() if pa[n] != pb[n]]
    counts = {}
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        for n in sorted(changed):
            if n.endswith('.xml') or n.endswith('.rels'):
                try:
                    trees = [ET.fromstring(z.read(n)) for z in (za, zb)]
                    counters = [collections.Counter(el.tag.rsplit('}', 1)[-1] for el in t.iter()) for t in trees]
                    lost = counters[0] - counters[1]
                    added = counters[1] - counters[0]
                    counts[n] = {'lost_tags': dict(lost), 'added_tags': dict(added)}
                except ET.ParseError: counts[n] = {'invalid_xml': True}
    return {'changed': sorted(changed), 'removed': sorted(pa.keys() - pb.keys()), 'added': sorted(pb.keys() - pa.keys()), 'tag_deltas': counts,
            'features_before': ia, 'features_after': ib,
            'feature_losses': {k: v - ib['features'].get(k, 0) for k, v in ia['features'].items() if v > ib['features'].get(k, 0)}}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', type=Path, default=Path.home() / 'stress-corpus-files')
    ap.add_argument('--results', type=Path, default=ROOT / 'results')
    ap.add_argument('--cli', type=Path, default=ROOT.parents[2] / 'crates/target/release/officec')
    ap.add_argument('--app-only', action='store_true')
    args = ap.parse_args()
    args.results.mkdir(parents=True, exist_ok=True)
    rows = list(csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t'))
    def check(row):
        name = row['file']; source = args.files / name
        if source.suffix not in {'.docx', '.pptx', '.xlsx', '.csv'}: return None
        result = {'name': name}
        if not args.app_only:
            dest = args.results / 'cli' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            start = time.monotonic()
            try:
                p = subprocess.run([str(args.cli), 'save', str(source), str(dest)], capture_output=True, text=True, timeout=90)
                result['cli'] = {'returncode': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr, 'seconds': round(time.monotonic() - start, 3)}
                if p.returncode == 0: result['cli']['diff'] = difference(source, dest)
            except subprocess.TimeoutExpired: result['cli'] = {'timeout': True}
        for browser in ('chromium', 'webkit'):
            dest = args.results / browser / name
            if dest.exists(): result[browser] = difference(source, dest)
        return result
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = [x for x in pool.map(check, rows) if x]
    (args.results / ('structure-app.json' if args.app_only else 'structure.json')).write_text(json.dumps(results, indent=2) + '\n')
    for x in results:
        print(x['name'], {k: (v.get('diff', v).get('changed', []), v.get('diff', v).get('feature_losses', {})) for k, v in x.items() if k != 'name'})

if __name__ == '__main__': main()
