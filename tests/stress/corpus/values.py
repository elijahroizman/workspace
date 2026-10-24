#!/usr/bin/env python3
"""Find cached spreadsheet values replaced by errors by the app's open/save path."""
import collections, csv, json, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
ROOT = Path(__file__).resolve().parent
NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def compare(source, saved):
    result = {'changed_value_or_type': 0, 'new_errors': {}, 'changed_formula_nodes': 0, 'samples': []}
    errors = collections.Counter()
    with zipfile.ZipFile(source) as a, zipfile.ZipFile(saved) as b:
        for part in a.namelist():
            if not part.startswith('xl/worksheets/') or not part.endswith('.xml'): continue
            if a.read(part) == b.read(part): continue
            cells = [{c.get('r'): c for c in ET.fromstring(z.read(part)).findall('.//x:c', NS)} for z in (a, b)]
            for address, before in cells[0].items():
                after = cells[1].get(address)
                if after is None: continue
                old, new = before.findtext('x:v', None, NS), after.findtext('x:v', None, NS)
                oldf, newf = before.find('x:f', NS), after.find('x:f', NS)
                form = lambda f: None if f is None else (dict(f.attrib), f.text)
                if form(oldf) != form(newf): result['changed_formula_nodes'] += 1
                if old == new and before.get('t') == after.get('t'): continue
                result['changed_value_or_type'] += 1
                if after.get('t') == 'e' and before.get('t') != 'e': errors[new] += 1
                if len(result['samples']) < 25:
                    result['samples'].append({'part': part, 'address': address, 'formula': form(oldf), 'before': old, 'after': new, 'after_type': after.get('t')})
    result['new_errors'] = dict(errors)
    return result

def main():
    results = []
    for row in csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t'):
        name = row['file']
        if not name.endswith('.xlsx'): continue
        for browser in ['chromium', 'webkit']:
            saved = ROOT / 'results' / browser / name
            if not saved.exists(): continue
            result = compare(Path.home() / 'stress-corpus-files' / name, saved)
            results.append({'name': name, 'browser': browser, **result})
            print(name, browser, result['changed_value_or_type'], result['new_errors'], flush=True)
    (ROOT / 'results/values.json').write_text(json.dumps(results, indent=2) + '\n')

if __name__ == '__main__': main()
