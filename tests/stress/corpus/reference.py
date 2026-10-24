#!/usr/bin/env python3
"""Reference PDF renders and saved-file reopen checks. Run on bbb with SOFFICE set."""
import argparse, concurrent.futures, csv, hashlib, json, os, re, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def pdf_info(path):
    pw = ['-upw', 'corpus'] if path.name == 'irs-fw9-password.pdf' else []
    p = subprocess.run(['pdfinfo', *pw, str(path)], capture_output=True, text=True, timeout=20)
    text = subprocess.run(['pdftotext', *pw, '-layout', str(path), '-'], capture_output=True, timeout=30)
    result = {'pdfinfo_returncode': p.returncode, 'pdfinfo': p.stdout, 'text_bytes': len(text.stdout), 'text_sha256': hashlib.sha256(text.stdout).hexdigest()}
    match = re.search(r'^Pages:\s+(\d+)', p.stdout, re.M)
    result['pages'] = int(match[1]) if match else None
    return result, text.stdout

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', type=Path, default=Path.home() / 'stress-corpus-files')
    ap.add_argument('--results', type=Path, default=ROOT / 'results')
    ap.add_argument('--soffice', default=os.environ.get('SOFFICE', 'soffice'))
    ap.add_argument('--filter', default='.')
    args = ap.parse_args()
    rows = [r for r in csv.DictReader((ROOT / 'manifest.tsv').open(), delimiter='\t') if re.search(args.filter, r['file'])]
    jobs = [(row['file'], mode) for row in rows for mode in ('original', 'cli', 'chromium', 'webkit')
            if (args.files / row['file'] if mode == 'original' else args.results / mode / row['file']).exists()]
    def check(job):
        name, mode = job
        source = args.files / name if mode == 'original' else args.results / mode / name
        dest = args.results / 'references' / mode / name
        dest.mkdir(parents=True, exist_ok=True)
        result = {'name': name, 'mode': mode}
        pdf = dest / (source.stem + '.pdf')
        try:
            if source.suffix == '.pdf':
                shutil.copyfile(source, pdf)
            else:
                with tempfile.TemporaryDirectory(prefix='corpus-lo-') as profile:
                    p = subprocess.run([args.soffice, '-env:UserInstallation=' + Path(profile).as_uri(), '--headless', '--convert-to', 'pdf', '--outdir', str(dest), str(source)], capture_output=True, text=True, timeout=75)
                    result.update(returncode=p.returncode, log=p.stdout, stderr=p.stderr[-1500:])
            if not pdf.exists(): raise RuntimeError('Reference PDF was not produced')
            info, text = pdf_info(pdf)
            result.update(info)
            (dest / 'text.txt').write_bytes(text)
            subprocess.run(['pdftoppm', *(['-upw', 'corpus'] if source.name == 'irs-fw9-password.pdf' else []), '-f', '1', '-singlefile', '-scale-to', '1400', '-png', str(pdf), str(dest / 'page-1')], capture_output=True, timeout=30, check=True)
            result['status'] = 'ok'
        except Exception as e:
            result.update(status='failed', error=str(e))
        print(mode, name, result['status'], result.get('pages'), flush=True)
        return result
    args.results.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(check, jobs))
    output = args.results / 'references.json'
    prior = json.loads(output.read_text()) if output.exists() else []
    combined = {(x['name'], x['mode']): x for x in prior}
    combined.update({(x['name'], x['mode']): x for x in results})
    output.write_text(json.dumps(list(combined.values()), indent=2) + '\n')

if __name__ == '__main__': main()
