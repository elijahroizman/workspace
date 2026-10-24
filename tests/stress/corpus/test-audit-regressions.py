#!/usr/bin/env python3
"""Focused, standard-library regressions for corpus audit false passes. Run on bbb."""
import contextlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


collect = load('collect', HERE / 'collect.py')
reference = load('reference', HERE / 'reference.py')
signatures = load('signatures', HERE / 'signatures.py')
summarize = load('summarize', HERE / 'summarize.py')
values = load('values', HERE / 'values.py')
verify = load('verify', HERE.parent / 'verify-corpus-fixes.py')


def package(path, part='word/document.xml', xml=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if xml is None:
        xml = f'<w:document xmlns:w="{verify.W[1:-1]}"><w:body><w:tbl><w:tr><w:tc/></w:tr></w:tbl></w:body></w:document>'
    with ZipFile(path, 'w') as z:
        if part:
            z.writestr(part, xml)


def signed(*statuses):
    return ''.join(f'Signature #{i}:\n  - Signature Validation: {status}\n  - Certificate Validation: Certificate has Expired\n'
                   for i, status in enumerate(statuses, 1))


VALID = 'Signature is Valid.'
MISMATCH = 'Digest Mismatch.'


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='writan-audit-regression-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = self.root / 'files'
        self.results = self.root / 'results'
        self.samples = self.root / 'samples'
        for directory in (self.files, self.results, self.samples):
            directory.mkdir()

    def manifest(self, *names):
        (self.root / 'manifest.tsv').write_text('file\tcategory\n' + ''.join(f'{name}\tregression\n' for name in names))

    def run_main(self, module, *args):
        with patch.object(module, 'ROOT', self.root), patch.object(sys, 'argv', ['audit', *map(str, args)]), contextlib.redirect_stdout(io.StringIO()):
            return module.main()

    def test_download_limit_boundary(self):
        for size in (7, 8, 9):
            with self.subTest(size=size), patch.object(collect, 'MAX_DOWNLOAD_BYTES', 8), patch.object(collect.urllib.request, 'urlopen', return_value=io.BytesIO(b'x' * size)):
                if size > 8:
                    with self.assertRaisesRegex(ValueError, 'exceeds 8'):
                        collect.get('https://example.invalid/file.docx')
                else:
                    self.assertEqual(collect.get('https://example.invalid/file.docx'), b'x' * size)

    def test_reference_cannot_reuse_stale_pdf(self):
        self.manifest('one.docx')
        (self.files / 'one.docx').touch()
        dest = self.results / 'references/original/one.docx'
        dest.mkdir(parents=True)
        for code in (0, 1):
            with self.subTest(returncode=code):
                stale = dest / 'one.pdf'
                stale.write_bytes(b'old PDF')
                with patch.object(reference.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, '', 'failed')), patch.object(reference, 'pdf_info') as info:
                    self.run_main(reference, '--files', self.files, '--results', self.results)
                result = json.loads((self.results / 'references.json').read_text())[0]
                self.assertEqual(result['status'], 'failed')
                self.assertFalse(stale.exists())
                info.assert_not_called()

    def test_intact_requires_success_and_comparison(self):
        diff = {'changed': [], 'added': [], 'removed': ['empty/']}
        self.assertTrue(summarize.intact({'returncode': 0, 'diff': diff}, 'cli'))
        self.assertTrue(summarize.intact(diff, 'chromium'))
        self.assertTrue(summarize.intact({'returncode': 0, 'diff': {'byte_identical': True}}, 'cli'))
        for comparison in ({}, {'returncode': 0}, {'timeout': True}, {'returncode': 1},
                           {'returncode': 1, 'diff': diff}, {'returncode': 0, 'timeout': True, 'diff': diff},
                           {'returncode': 0, 'diff': {}}, {'returncode': 0, 'diff': None},
                           {'returncode': 0, 'diff': {**diff, 'removed': ['word/document.xml']}},
                           {'returncode': 0, 'diff': {'byte_identical': False}}):
            with self.subTest(comparison=comparison):
                self.assertFalse(summarize.intact(comparison, 'cli'))

    def test_summary_does_not_count_failed_cli_save_as_unchanged(self):
        self.manifest('ok.docx', 'failed.docx', 'timeout.docx', 'missing-diff.docx')
        for browser in ('chromium', 'webkit'):
            (self.results / f'browser-{browser}.jsonl').touch()
        (self.results / 'structure.json').write_text(json.dumps([
            {'name': 'ok.docx', 'cli': {'returncode': 0, 'diff': {'byte_identical': True}}},
            {'name': 'failed.docx', 'cli': {'returncode': 1}},
            {'name': 'timeout.docx', 'cli': {'timeout': True}},
            {'name': 'missing-diff.docx', 'cli': {'returncode': 0}},
        ]))
        with patch.object(summarize, 'RESULTS', self.results):
            self.run_main(summarize)
        evidence = json.loads((self.root / 'evidence/2026-10-24.json').read_text())
        self.assertEqual(evidence['formats']['docx']['cli_parts_unchanged'], {'tested': 4, 'passed': 1})

    def workbook(self, path, cells, part='xl/worksheets/sheet1.xml'):
        package(path, part, '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>' + cells + '</row></sheetData></worksheet>')

    def test_values_reports_missing_part_and_continues_other_workbooks(self):
        self.manifest('lost.xlsx', 'good.xlsx')
        cell = '<c r="A1"><f>1+1</f><v>2</v></c>'
        for name in ('lost.xlsx', 'good.xlsx'):
            self.workbook(self.files / name, cell)
            self.workbook(self.results / 'chromium' / name, cell, None if name == 'lost.xlsx' else 'xl/worksheets/sheet1.xml')
        with patch.object(values.Path, 'home', return_value=self.root):
            # values.py uses the historical fixed corpus directory.
            self.files.rename(self.root / 'stress-corpus-files')
            self.run_main(values)
        records = json.loads((self.results / 'values.json').read_text())
        lost, good = records
        self.assertEqual(lost['missing_parts'], ['xl/worksheets/sheet1.xml'])
        self.assertEqual(lost['changed_value_or_type'], 1)
        self.assertEqual(lost['changed_formula_nodes'], 1)
        self.assertEqual(lost['status'], 'failed')
        self.assertEqual(good['status'], 'ok')

    def test_values_counts_deleted_cell_and_checks_next_sheet(self):
        original, saved = self.files / 'book.xlsx', self.results / 'book.xlsx'
        self.workbook(original, '<c r="A1"><v>7</v></c>')
        self.workbook(saved, '', None)
        # A dropped first sheet must not prevent checking a later sheet.
        with ZipFile(original, 'a') as z:
            z.writestr('xl/worksheets/sheet2.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B1"><v>9</v></c><c r="C1"><v>3</v></c></worksheet>')
        with ZipFile(saved, 'a') as z:
            z.writestr('xl/worksheets/sheet2.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="C1"><v>3</v></c></worksheet>')
        result = values.compare(original, saved)
        self.assertEqual(result['changed_value_or_type'], 2)
        self.assertEqual(result['missing_cells'], 2)
        self.assertEqual(result['status'], 'failed')

    def signature_run(self, saved_text, missing=False, error=None, original_text=None, saved_code=0):
        self.manifest('signed.pdf', 'unsigned.pdf')
        for mode in ('chromium', 'webkit'):
            target = self.results / mode / 'signed.pdf'
            target.parent.mkdir(exist_ok=True)
            if not missing:
                target.touch()
        original_text = original_text or signed(VALID, VALID)

        def pdfsig(command, **kwargs):
            path = Path(command[-1])
            if path.name == 'unsigned.pdf':
                return subprocess.CompletedProcess(command, 2, "File does not contain any signatures\n", '')
            if path.parent == self.files:
                return subprocess.CompletedProcess(command, 0, original_text, '')
            if error:
                raise error
            return subprocess.CompletedProcess(command, saved_code, saved_text, '')
        with patch.object(signatures.subprocess, 'run', side_effect=pdfsig):
            code = self.run_main(signatures, '--files', self.files, '--results', self.results)
        records = json.loads((self.results / 'signatures.json').read_text())
        self.assertEqual(len(records), 1)
        return code, records[0]

    def test_signature_multiple_digests_pass_with_expired_certificate(self):
        code, record = self.signature_run(signed(VALID, VALID))
        self.assertEqual(code, 0)
        self.assertEqual(record['status'], 'ok')

    def test_signature_second_digest_regression_or_removal_fails(self):
        for output in (signed(VALID, MISMATCH), signed(VALID), '', 'Signature #1:\n'):
            with self.subTest(output=output):
                code, record = self.signature_run(output)
                self.assertEqual(code, 1)
                self.assertEqual(set(record['errors']), {'chromium', 'webkit'})
                self.assertEqual(record['saves']['chromium'], output)

    def test_signature_missing_save_fails(self):
        code, record = self.signature_run('', missing=True)
        self.assertEqual(code, 1)
        self.assertIn('Missing saved PDF', record['errors']['chromium'])

    def test_signature_timeout_writes_evidence(self):
        code, record = self.signature_run('', error=subprocess.TimeoutExpired('pdfsig', 30))
        self.assertEqual(code, 1)
        self.assertIn('timed out', record['errors']['webkit'])

    def test_signature_nonzero_exit_keeps_digest_evidence(self):
        output = signed(VALID, MISMATCH)
        code, record = self.signature_run(output, saved_code=1)
        self.assertEqual(code, 1)
        self.assertEqual(record['saves']['webkit'], output)
        self.assertIn('non-zero exit status 1', record['errors']['webkit'])

    def test_signature_original_missing_digest_fails(self):
        code, record = self.signature_run('', original_text='Signature #1:\n')
        self.assertEqual(code, 1)
        self.assertIn('original', record['errors'])

    def test_signature_tool_error_is_not_unsigned(self):
        with patch.object(signatures.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2, '', 'broken')):
            with self.assertRaises(subprocess.CalledProcessError):
                signatures.inspect(self.files / 'broken.pdf', allow_unsigned=True)

    def verify_run(self, officec=None, fails=False):
        args = ['--files', self.files, '--results', self.results]
        if officec:
            args += ['--officec', officec]
        if fails:
            with self.assertRaises(SystemExit):
                self.run_main(verify, *args)
        else:
            self.run_main(verify, *args)
        return json.loads((self.results / 'table-order-cli.json').read_text())

    def good_docx(self, name='good.docx'):
        package(self.files / name)
        target = self.results / 'cli' / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(self.files / name, target)

    def test_verify_missing_output_cannot_hide_behind_pass(self):
        self.good_docx()
        package(self.files / 'missing.docx')
        records = self.verify_run(fails=True)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]['status'], 'ok')
        self.assertIn('Missing saved', records[1]['error'])

    def test_verify_explicit_refusals_reported_before_snapshot(self):
        self.good_docx()
        for name in verify.EXPECTED_REFUSALS:
            (self.samples / name).write_bytes(b'not a DOCX')
        records = self.verify_run()
        self.assertEqual(len(records), 1 + len(verify.EXPECTED_REFUSALS))
        self.assertTrue(all(r['status'] == 'skipped_expected_refusal' for r in records[1:]))

    def test_verify_unexpected_malformed_output_records_error_and_continues(self):
        self.good_docx()
        for name, part, xml in (('bad-xml.docx', 'word/document.xml', '<'),
                                ('missing-part.docx', 'other.xml', '<ok/>')):
            package(self.files / name, part, xml)
            package(self.results / 'cli' / name, part, xml)
        (self.files / 'broken-zip.docx').write_bytes(b'bad zip')
        (self.results / 'cli' / 'broken-zip.docx').write_bytes(b'bad zip')
        records = self.verify_run(fails=True)
        self.assertEqual(len(records), 4)
        self.assertEqual(sum(r['status'] == 'ok' for r in records), 1)
        self.assertEqual(sum('error' in r for r in records), 3)

    def test_verify_cli_refusal_and_stale_output(self):
        self.good_docx()
        refusal = self.samples / 'S2-truncated.docx'
        refusal.touch()
        stale = self.results / 'cli' / refusal.name
        stale.write_bytes(b'old save')

        def save(command, **kwargs):
            source, dest = map(Path, command[-2:])
            if source.name == refusal.name:
                return subprocess.CompletedProcess(command, 1, '', 'refused')
            shutil.copyfile(source, dest)
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.object(verify.subprocess, 'run', side_effect=save):
            records = self.verify_run('/fake/officec')
        self.assertFalse(stale.exists())
        self.assertEqual(records[-1]['status'], 'expected_refusal')
        self.assertEqual(records[-1]['cli']['stderr'], 'refused')

    def test_verify_unexpected_cli_failure_and_timeout_write_evidence(self):
        self.good_docx()
        for failure in (subprocess.CompletedProcess([], 1, '', 'save failed'),
                        subprocess.TimeoutExpired('officec', 90), FileNotFoundError('officec')):
            with self.subTest(failure=failure):
                effect = {'side_effect': failure} if isinstance(failure, Exception) else {'return_value': failure}
                with patch.object(verify.subprocess, 'run', **effect):
                    records = self.verify_run('/fake/officec', fails=True)
                self.assertEqual(records[0]['status'], 'failed')
                self.assertIn('error', records[0])

    def test_verify_refusal_name_in_downloads_is_not_excluded(self):
        self.good_docx()
        (self.files / 'S2-truncated.docx').touch()
        records = self.verify_run(fails=True)
        self.assertEqual(records[0]['status'], 'failed')

    def test_verify_no_checked_sources_still_writes_evidence(self):
        (self.samples / 'S2-empty.docx').touch()
        records = self.verify_run(fails=True)
        self.assertEqual(records[0]['status'], 'skipped_expected_refusal')

    def test_verify_cli_accepting_expected_refusal_fails(self):
        self.good_docx()
        (self.samples / 'S2-empty.docx').touch()
        with patch.object(verify.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', '')):
            records = self.verify_run('/fake/officec', fails=True)
        self.assertEqual(records[-1]['status'], 'failed')
        self.assertIn('accepted', records[-1]['error'])


if __name__ == '__main__':
    unittest.main()
