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
            # A fixed date, so the same sample comes out byte for byte.
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode() if isinstance(data, str) else data)
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

# 5,000 cells pointing at one 1 MB shared string: 5 GB once each cell had its own copy (POI's
# poc-shared-strings.xlsx is the same attack). Now a "too large to open" error.
sst = f'{DECL}<sst xmlns="{X}"><si><t>{"x" * (1 << 20)}</t></si></sst>'
rows = "".join(f'<row r="{r}"><c r="A{r}" t="s"><v>0</v></c></row>' for r in range(1, 5001))
save("S1-shared-string-amplification-oom.xlsx", xlsx([("Sheet1", rows)], sst=sst))

# A plain document, for encrypting (below).
save("plain.docx", docx('<w:p><w:r><w:t>Secret</w:t></w:r></w:p>'))
try:
    from msoffcrypto.format.ooxml import OOXMLFile  # pip install msoffcrypto-tool

    with open(os.path.join(out, "plain.docx"), "rb") as f, open(os.path.join(out, "S2-password-protected.docx"), "wb") as o:
        OOXMLFile(f).encrypt("stress", o)
except ImportError:
    print("msoffcrypto-tool isn't installed: S2-password-protected.docx not written")
os.remove(os.path.join(out, "plain.docx"))

# Entries named `xl\workbook.xml`, as some .NET writers make them (POI's 49609.xlsx): "the file
# has no main document part".
save("S2-backslash-part-names.xlsx", xlsx([("Sheet1", '<row r="1"><c r="A1"><v>42</v></c></row>')], sep="\\"))

# A sheet name with a line break Excel wrote as `_x000a_` (POI's xssf-enum.xltx.xlsx): 28
# characters, counted as 34, so saving failed with "invalid or duplicate worksheet name".
save("S1-sheet-name-escape-cant-save.xlsx", xlsx([("Контрольний список  &quot;Школа&quot;_x000a_", '<row r="1"><c r="A1"><v>1</v></c></row>')]))
