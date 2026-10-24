#!/usr/bin/env python3
"""PDF unchanged-save content checks. Run with uv run --with pypdf this-file.py."""
import csv, hashlib, json
from pathlib import Path
from pypdf import PdfReader
ROOT = Path(__file__).resolve().parent

def inventory(path):
    reader = PdfReader(path)
    if reader.is_encrypted: reader.decrypt('corpus' if path.name == 'irs-fw9-password.pdf' else '')
    def value(v):
        if v is None: return None
        obj = v.get_object() if hasattr(v, 'get_object') else v
        if isinstance(obj, dict) and obj.get('/Type') == '/Sig':
            return {k: (hashlib.sha256(bytes(obj[k])).hexdigest() if k == '/Contents' else str(obj[k])) for k in ['/Type', '/Filter', '/SubFilter', '/Name', '/Reason', '/M', '/ByteRange', '/Contents'] if k in obj}
        return str(obj)
    root = reader.trailer['/Root']
    fields = reader.get_fields() or {}
    pages = []
    for page in reader.pages:
        annotations = []
        for ref in page.get('/Annots', []):
            a = ref.get_object()
            annotations.append({key: ([round(float(x), 3) for x in a[key]] if key == '/Rect' else value(a.get(key))) for key in ['/Subtype', '/T', '/V', '/FT', '/Rect', '/Contents', '/F'] if key in a})
        pages.append({'media': [round(float(x), 3) for x in page.mediabox], 'crop': [round(float(x), 3) for x in page.cropbox], 'rotation': page.rotation,
                      'text': page.extract_text(), 'annotations': annotations})
    return {'encrypted': reader.is_encrypted, 'pages': pages, 'fields': {k: {p: value(v.get(p)) for p in ['/FT', '/V', '/DV', '/Ff']} for k, v in fields.items()},
            'attachments': {name: [hashlib.sha256(b).hexdigest() for b in data] for name, data in reader.attachments.items()},
            'has_acroform': '/AcroForm' in root, 'has_outlines': '/Outlines' in root, 'has_structure': '/StructTreeRoot' in root}

def main():
    rows = list(csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t'))
    results = []
    for row in rows:
        name = row['file']
        if not name.endswith('.pdf'): continue
        try: before = inventory(Path.home() / 'stress-corpus-files' / name)
        except Exception as e:
            results.append({'name': name, 'source_error': str(e)}); continue
        for kind in ['chromium', 'webkit']:
            saved = ROOT / 'results' / kind / name
            if not saved.exists(): continue
            try:
                after = inventory(saved)
                delta = {key: {'before': before[key], 'after': after[key]} for key in before if before[key] != after[key]}
                results.append({'name': name, 'browser': kind, 'pages': len(before['pages']), 'fields': len(before['fields']), 'differences': {k: (v if k != 'pages' else {'before_count': len(v['before']), 'after_count': len(v['after']), 'changed_pages': [i + 1 for i, pair in enumerate(zip(v['before'], v['after'])) if pair[0] != pair[1]]}) for k, v in delta.items()}})
                print(name, kind, list(delta), flush=True)
            except Exception as e: results.append({'name': name, 'browser': kind, 'error': str(e)})
    (ROOT / 'results' / 'pdf-audit.json').write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n')

if __name__ == '__main__': main()
