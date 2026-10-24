#!/usr/bin/env python3
"""Discover published documents. Run on bbb; never imports or executes downloads."""
import argparse, concurrent.futures, csv, hashlib, html, json, re, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UA = 'Writan-fidelity-corpus/1.0 (public document compatibility testing)'

def get(url):
    url = urllib.parse.quote(url, safe=':/?&=%+#')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=90) as r:
        return r.read(80 * 1024 * 1024)

def links(page):
    text = get(page).decode('utf-8', 'replace')
    return list(dict.fromkeys(urllib.parse.urljoin(page, html.unescape(x)) for x in re.findall(r'href\s*=\s*[\"\']([^\"\']+)', text, re.I)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', type=Path, default=Path.home() / 'stress-corpus-files')
    args = ap.parse_args()
    args.dest.mkdir(parents=True, exist_ok=True)
    candidates = []
    sources = [
        ('nz', 'https://www.procurement.govt.nz/templates/', {'docx'}, 24, 'NZ government template; rights not verified; URL-only, do not redistribute'),
        ('pa', 'https://www.pa.gov/agencies/budget/publications-and-reports/commonwealth-budget/agency-templates', {'xlsx'}, 10, 'Pennsylvania government; all rights reserved; URL-only'),
        ('ucsd', 'https://grad.ucsd.edu/academics/preparing-to-graduate/dissertation-thesis-template.html', {'docx'}, 4, 'UC Regents copyright; publicly offered template; URL-only'),
        ('siu', 'https://siu.edu/admissions/graduate/academic-support/thesis-dissertation-research/etd/etd-templates.php', {'docx'}, 3, 'University template; redistribution not verified; URL-only'),
        ('nasa', 'https://sewp.nasa.gov/documents/training/sewp.shtml', {'pptx'}, 4, 'NASA training; third-party graphics possible; URL-only'),
        ('nih', 'https://grants.nih.gov/grants/forms/biosketch.htm', {'docx'}, 4, 'US federal government form; public domain federal text'),
        ('mass', 'https://budget.digital.mass.gov/govbudget/fy27/downloads', {'xlsx'}, 5, 'Massachusetts government; rights not verified; URL-only'),
    ]
    for prefix, page, exts, cap, note in sources:
        try:
            urls = [u for u in links(page) if urllib.parse.urlparse(u).path.lower().rsplit('.', 1)[-1] in exts][:cap]
            for u in urls:
                basename = urllib.parse.unquote(urllib.parse.urlparse(u).path.rsplit('/', 1)[-1])
                name = prefix + '-' + re.sub(r'[^A-Za-z0-9._-]+', '-', basename)
                candidates.append((name, urllib.parse.quote(u, safe=':/?&=%+#'), note, 'published'))
            print(prefix, len(urls), flush=True)
        except Exception as e:
            print(prefix, str(e), file=sys.stderr, flush=True)
    for f in ['fw4', 'fw9', 'f1040', 'f1040s1', 'f1040s2', 'f1040s3', 'f1040sa', 'f1040sb', 'f1040sc', 'f941', 'f4506t', 'fss4']:
        candidates.append(('irs-' + f + '.pdf', 'https://www.irs.gov/pub/irs-pdf/' + f + '.pdf', 'US federal government IRS form; public domain federal text', 'published'))
    # Supplemental fixtures are explicitly distinguished from published real-world files.
    paths = [
        ('sw/qa/extras/ooxmlexport/data', 'docx', ['arabic', 'hebrew', 'chinese', 'japanese', 'korean', 'math', 'footnote', 'smartart', 'sdt', 'iwork', 'googledocs', 'libreoffice', 'tracked']),
        ('sd/qa/unit/data/pptx', 'pptx', ['smartart', 'chart', 'math', 'font', 'media', 'group', 'iwork', 'google']),
        ('sc/qa/unit/data/xlsx', 'xlsx', ['conditional', 'validation', 'formula', 'chart', 'date', 'merged', 'google']),
    ]
    for path, ext, terms in paths:
        try:
            listing = json.loads(get('https://api.github.com/repos/LibreOffice/core/contents/' + path + '?ref=master'))
            chosen = []
            for term in terms:
                hits = [x for x in listing if term in x['name'].lower() and x['name'].lower().endswith('.' + ext) and x['size'] < 4000000]
                if hits:
                    chosen.append(hits[0])
            for x in {x['name']: x for x in chosen}.values():
                candidates.append(('lo-' + x['name'], x['download_url'], 'LibreOffice regression fixture; individual document provenance not verified; URL-only', 'regression'))
            print('lo', ext, len(chosen), flush=True)
        except Exception as e:
            print(path, str(e), file=sys.stderr)
    candidates.extend([
        ('pdfjs-arabic.pdf', 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/ArabicCIDTrueType.pdf', 'PDF.js regression fixture; provenance not verified; URL-only', 'regression'),
        ('pdfjs-cjk.pdf', 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/cjk.pdf', 'PDF.js regression fixture; provenance not verified; URL-only', 'regression'),
        ('pdfjs-encrypted.pdf', 'https://raw.githubusercontent.com/mozilla/pdf.js/master/test/pdfs/encrypted.pdf', 'PDF.js regression fixture; provenance not verified; URL-only', 'regression'),
        ('iris.csv', 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv', 'Public Fisher iris dataset; source license not verified; URL-only', 'published'),
        ('titanic.csv', 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/titanic.csv', 'Public Titanic dataset; source license not verified; URL-only', 'published'),
    ])
    def download(row):
        name, url, note, category = row
        try:
            data = get(url)
            ext = name.rsplit('.', 1)[-1].lower()
            if ext in ('docx', 'pptx', 'xlsx') and not data.startswith(b'PK'):
                raise ValueError('not an OOXML ZIP')
            if ext == 'pdf' and not data.startswith(b'%PDF'):
                raise ValueError('not a PDF')
            (args.dest / name).write_bytes(data)
            return [name, url, hashlib.sha256(data).hexdigest(), note, category, str(len(data))]
        except Exception as e:
            print('FAILED', name, str(e), file=sys.stderr, flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        rows = [r for r in pool.map(download, candidates) if r]
    with (ROOT / 'manifest.tsv').open('w') as f:
        writer = csv.writer(f, delimiter='\t', lineterminator='\n')
        writer.writerow(['file', 'source_url', 'sha256', 'redistribution_note', 'category', 'bytes'])
        writer.writerows(sorted(rows))
    print('Downloaded', len(rows), 'documents', flush=True)

if __name__ == '__main__':
    main()
