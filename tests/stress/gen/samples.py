#!/usr/bin/env python3
"""Writes the small repro files in tests/stress/samples/ (standard library only):

    python3 tests/stress/gen/samples.py tests/stress/samples

Each sample is a minimal package written by hand, so it shows exactly the markup that matters.
"""
import io
import os
import sys
import zipfile

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "samples")
os.makedirs(out, exist_ok=True)

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
X = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def zipped(parts, names=None):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts:
            z.writestr(name, data.encode() if isinstance(data, str) else data)
    return b.getvalue()


def types(overrides, defaults=(("rels", "application/vnd.openxmlformats-package.relationships+xml"), ("xml", "application/xml"))):
    d = "".join(f'<Default Extension="{e}" ContentType="{t}"/>' for e, t in defaults)
    o = "".join(f'<Override PartName="{p}" ContentType="{t}"/>' for p, t in overrides)
    return f'{DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{d}{o}</Types>'


def rels(items):
    r = "".join(f'<Relationship Id="{i}" Type="{t}" Target="{target}"/>' for i, t, target in items)
    return f'{DECL}<Relationships xmlns="{REL}">{r}</Relationships>'


DOCX_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
XLSX_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
XLSX_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
XLSX_SST = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
WS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
SST = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"


def docx(body, extra_parts=(), extra_types=(), doc_rels=()):
    parts = [
        ("[Content_Types].xml", types([("/word/document.xml", DOCX_MAIN), *extra_types])),
        ("_rels/.rels", rels([("rId1", OD, "word/document.xml")])),
        ("word/document.xml", f'{DECL}<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr/></w:body></w:document>'),
    ]
    if doc_rels:
        parts.append(("word/_rels/document.xml.rels", rels(doc_rels)))
    return zipped(parts + list(extra_parts))


def xlsx(sheets, sst=None, workbook_ns=X, sep="/"):
    """sheets: [(name, sheetData inner xml)]"""
    entries = "".join(f'<sheet name="{n}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, (n, _) in enumerate(sheets))
    wb_rels = [(f"rId{i + 1}", WS, f"worksheets/sheet{i + 1}.xml") for i in range(len(sheets))]
    overrides = [("/xl/workbook.xml", XLSX_MAIN)] + [(f"/xl/worksheets/sheet{i + 1}.xml", XLSX_SHEET) for i in range(len(sheets))]
    parts = [
        ("_rels/.rels", rels([("rId1", OD, "xl/workbook.xml")])),
        ("xl/workbook.xml", f'{DECL}<workbook xmlns="{workbook_ns}" xmlns:r="{R}"><sheets>{entries}</sheets></workbook>'),
    ]
    for i, (_, data) in enumerate(sheets):
        parts.append((f"xl/worksheets/sheet{i + 1}.xml", f'{DECL}<worksheet xmlns="{X}"><sheetData>{data}</sheetData></worksheet>'))
    if sst is not None:
        wb_rels.append(("rIdS", SST, "sharedStrings.xml"))
        overrides.append(("/xl/sharedStrings.xml", XLSX_SST))
        parts.append(("xl/sharedStrings.xml", sst))
    parts.append(("xl/_rels/workbook.xml.rels", rels(wb_rels)))
    parts.insert(0, ("[Content_Types].xml", types(overrides)))
    return zipped([(n.replace("/", sep) if n != "[Content_Types].xml" else n, d) for n, d in parts])


def save(name, data):
    with open(os.path.join(out, name), "wb") as f:
        f.write(data)


# An Excel workbook with a .docx name: the Word view panicked on the workbook's body.
save("S1-xlsx-named-docx-panics.docx", xlsx([("Sheet1", '<row r="1"><c r="A1"><v>1</v></c></row>')]))

# A row numbered 2^31: the sheet grid asked for 16 GB of row positions and aborted.
save("S1-row-2147483648-oom.xlsx", xlsx([("Sheet1", '<row r="2147483648"><c r="A1"><v>1</v></c></row>')]))
