#!/usr/bin/env python3
"""Writes hostile and out-of-range files for the stress harness (not committed: the ones that
found a bug have a minimal copy in tests/stress/samples/).

    python hostile.py OUT_DIR        (needs python-docx, python-pptx, openpyxl)
    tests/stress/harness/target/release/drive --edit --stack 1024 OUT_DIR/*

Each file starts from a small document made by the Python libraries, with one part rewritten.
"""
import io
import os
import re
import sys
import zipfile

import docx
import openpyxl
import pptx
from pptx.util import Inches

out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def base_docx():
    d = docx.Document()
    d.add_paragraph("Base paragraph")
    t = d.add_table(rows=1, cols=2)
    t.cell(0, 0).text = "a"
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


def base_pptx():
    p = pptx.Presentation()
    s = p.slides.add_slide(p.slide_layouts[1])
    s.shapes.title.text = "Title"
    s.placeholders[1].text = "Body"
    s.shapes.add_textbox(Inches(1), Inches(5), Inches(4), Inches(1)).text_frame.text = "Box"
    b = io.BytesIO()
    p.save(b)
    return b.getvalue()


def base_xlsx():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws["A1"] = 1
    ws["B1"] = "text"
    ws["C1"] = "=A1*2"
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


BASES = {"docx": base_docx(), "pptx": base_pptx(), "xlsx": base_xlsx()}


def parts_of(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    return [(i.filename, z.read(i.filename)) for i in z.infolist()]


def rezip(parts):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in parts:
            z.writestr(n, d)
    return b.getvalue()


def edit(kind, name, part, fn):
    """Writes OUT/name.kind: the base file with `part` passed through fn(str) -> str|bytes."""
    parts = []
    for n, d in parts_of(BASES[kind]):
        if n == part:
            new = fn(d.decode("utf-8"))
            d = new.encode("utf-8") if isinstance(new, str) else new
        parts.append((n, d))
    with open(os.path.join(out, f"{name}.{kind}"), "wb") as f:
        f.write(rezip(parts))


def add_parts(kind, name, extra, edits=()):
    parts = parts_of(BASES[kind])
    for part, fn in edits:
        parts = [(n, (fn(d.decode()).encode() if n == part else d)) for n, d in parts]
    with open(os.path.join(out, f"{name}.{kind}"), "wb") as f:
        f.write(rezip(parts + list(extra)))


def raw(name, data):
    with open(os.path.join(out, name), "wb") as f:
        f.write(data)


DOC = "word/document.xml"
SLIDE = "ppt/slides/slide1.xml"
SHEET = "xl/worksheets/sheet1.xml"


def body(xml):
    """Puts xml at the start of the Word body."""
    return lambda s: s.replace("<w:body>", "<w:body>" + xml, 1)


def first_para_runs(xml):
    return lambda s: re.sub(r"(<w:p>|<w:p [^>]*>)", lambda m: m.group(1) + xml, s, count=1)


def sheet_data(xml):
    return lambda s: re.sub(r"<sheetData>.*</sheetData>|<sheetData/>", "<sheetData>" + xml + "</sheetData>", s, flags=re.S)


def sp_tree(xml):
    return lambda s: s.replace("</p:spTree>", xml + "</p:spTree>", 1)


# ---- XML itself ----
lol = '<!DOCTYPE w:document [<!ENTITY lol "lollollollollollollollollollol">' + "".join(
    f'<!ENTITY lol{i} "{("&lol" + (str(i - 1) if i > 1 else "") + ";") * 10}">' for i in range(1, 10)
) + "]>"
edit("docx", "billion-laughs", DOC, lambda s: s.replace("<w:document", lol + "<w:document", 1).replace("Base paragraph", "&lol9;"))
edit("docx", "xxe", DOC, lambda s: s.replace("<w:document", '<!DOCTYPE w:document [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><w:document', 1).replace("Base paragraph", "&xxe;"))
edit("docx", "utf16", DOC, lambda s: s.replace('encoding="UTF-8"', 'encoding="UTF-16"').encode("utf-16"))
edit("docx", "utf8-bom", DOC, lambda s: b"\xef\xbb\xbf" + s.encode())
edit("docx", "invalid-utf8", DOC, lambda s: s.replace("Base paragraph", "Base \udcff").encode("utf-8", "surrogateescape"))
edit("docx", "huge-attribute", DOC, lambda s: s.replace("<w:p>", '<w:p w14:paraId="' + "A" * 50_000_000 + '">', 1))
edit("docx", "control-chars", DOC, lambda s: s.replace("Base paragraph", "a&#1;b&#xFFFE;c&#x1F600;d"))
edit("docx", "nul-char-ref", DOC, lambda s: s.replace("Base paragraph", "a&#0;b"))
edit("docx", "unclosed", DOC, lambda s: s.replace("</w:body>", ""))
edit("docx", "empty-part", DOC, lambda s: "")
edit("docx", "no-root", DOC, lambda s: '<?xml version="1.0"?>')
edit("docx", "two-roots", DOC, lambda s: s + s[s.index("<w:document"):])
edit("docx", "unbound-prefix", DOC, lambda s: s.replace("<w:p>", "<zz:p>", 1).replace("</w:p>", "</zz:p>", 1))
edit("docx", "namespace-ns0", DOC, lambda s: s.replace("xmlns:w=", "xmlns:ns0=").replace("<w:", "<ns0:").replace("</w:", "</ns0:").replace(" w:", " ns0:"))
edit("docx", "strict-namespaces", DOC, lambda s: s.replace("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"))

# ---- nesting ----
for n in (300, 511, 1000):
    edit("docx", f"deep-sdt-{n}", DOC, body("<w:sdt><w:sdtContent>" * n + "<w:p><w:r><w:t>deep</w:t></w:r></w:p>" + "</w:sdtContent></w:sdt>" * n))
for n in (50, 150, 300, 340):
    cell = "<w:tbl><w:tblGrid><w:gridCol w:w=\"100\"/></w:tblGrid><w:tr><w:tc>"
    end = "<w:p/></w:tc></w:tr></w:tbl>"
    edit("docx", f"nested-tables-{n}", DOC, body(cell * n + "<w:p><w:r><w:t>deep</w:t></w:r></w:p>" + end * n + "<w:p/>"))
for n in (400, 1000):
    edit("docx", f"deep-smarttag-{n}", DOC, first_para_runs("<w:smartTag w:uri=\"u\" w:element=\"e\">" * n + "<w:r><w:t>x</w:t></w:r>" + "</w:smartTag>" * n))
    edit("docx", f"deep-hyperlink-{n}", DOC, first_para_runs("<w:hyperlink w:anchor=\"a\">" * n + "<w:r><w:t>x</w:t></w:r>" + "</w:hyperlink>" * n))
    edit("docx", f"deep-ins-{n}", DOC, first_para_runs("<w:ins w:id=\"1\" w:author=\"a\">" * n + "<w:r><w:t>x</w:t></w:r>" + "</w:ins>" * n))
for n in (200, 500):
    grp = '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="{i}" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>'
    inner = '<p:sp><p:nvSpPr><p:cNvPr id="9999" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>deep</a:t></a:r></a:p></p:txBody></p:sp>'
    edit("pptx", f"deep-groups-{n}", SLIDE, sp_tree("".join(grp.format(i=1000 + i) for i in range(n)) + inner + "</p:grpSp>" * n))

# ---- numbers out of range ----
edit("docx", "gridspan-1e9", DOC, lambda s: s.replace("<w:tcPr>", '<w:tcPr><w:gridSpan w:val="1000000000"/>', 1))
edit("docx", "gridspan-negative", DOC, lambda s: s.replace("<w:tcPr>", '<w:tcPr><w:gridSpan w:val="-5"/>', 1))
edit("docx", "many-gridcols", DOC, lambda s: re.sub(r"<w:tblGrid>.*?</w:tblGrid>", "<w:tblGrid>" + '<w:gridCol w:w="10"/>' * 100_000 + "</w:tblGrid>", s, count=1, flags=re.S))
edit("docx", "many-cells", DOC, lambda s: s.replace("</w:tr>", '<w:tc><w:p/></w:tc>' * 50_000 + "</w:tr>", 1))
edit("docx", "many-rows", DOC, lambda s: s.replace("</w:tbl>", '<w:tr><w:tc><w:p><w:r><w:t>r</w:t></w:r></w:p></w:tc></w:tr>' * 50_000 + "</w:tbl>", 1))
edit("docx", "vmerge-only", DOC, lambda s: s.replace("</w:tbl>", '<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr>' * 2000 + "</w:tbl>", 1))
for v in ("99999999999", "-99999999", "0", "NaN", "1e308", "4294967296"):
    tag = v.replace(".", "_")
    edit("docx", f"pgsz-{tag}", DOC, lambda s, v=v: re.sub(r"<w:pgSz [^>]*/>", f'<w:pgSz w:w="{v}" w:h="{v}"/>', s))
    edit("docx", f"pgmar-{tag}", DOC, lambda s, v=v: re.sub(r"<w:pgMar [^>]*/>", f'<w:pgMar w:top="{v}" w:right="{v}" w:bottom="{v}" w:left="{v}" w:header="{v}" w:footer="{v}" w:gutter="{v}"/>', s))
    edit("docx", f"cols-{tag}", DOC, lambda s, v=v: re.sub(r"<w:cols [^>]*/>", f'<w:cols w:num="{v}" w:space="{v}"/>', s))
    edit("docx", f"fontsize-{tag}", DOC, first_para_runs(f'<w:r><w:rPr><w:sz w:val="{v}"/></w:rPr><w:t>size</w:t></w:r>'))
    edit("docx", f"indent-{tag}", DOC, lambda s, v=v: s.replace("<w:p>", f'<w:p><w:pPr><w:ind w:left="{v}" w:right="{v}" w:firstLine="{v}" w:hanging="{v}"/></w:pPr>', 1))
    edit("docx", f"spacing-{tag}", DOC, lambda s, v=v: s.replace("<w:p>", f'<w:p><w:pPr><w:spacing w:before="{v}" w:after="{v}" w:line="{v}" w:lineRule="exact"/></w:pPr>', 1))
    edit("docx", f"spacing-auto-{tag}", DOC, lambda s, v=v: s.replace("<w:p>", f'<w:p><w:pPr><w:spacing w:line="{v}" w:lineRule="auto"/></w:pPr>', 1))
    edit("docx", f"tabs-{tag}", DOC, lambda s, v=v: s.replace("<w:p>", f'<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="{v}"/></w:tabs></w:pPr><w:r><w:tab/><w:t>x</w:t></w:r>', 1))
    edit("docx", f"rowheight-{tag}", DOC, lambda s, v=v: s.replace("<w:tr>", f'<w:tr><w:trPr><w:trHeight w:val="{v}" w:hRule="exact"/></w:trPr>', 1))
    edit("docx", f"cellwidth-{tag}", DOC, lambda s, v=v: re.sub(r'<w:gridCol w:w="\d+"/>', f'<w:gridCol w:w="{v}"/>', s))
    edit("pptx", f"sldsz-{tag}", "ppt/presentation.xml", lambda s, v=v: re.sub(r'<p:sldSz [^>]*/>', f'<p:sldSz cx="{v}" cy="{v}"/>', s))
    edit("pptx", f"xfrm-{tag}", SLIDE, lambda s, v=v: re.sub(r'<a:off x="\d+" y="\d+"/><a:ext cx="\d+" cy="\d+"/>', f'<a:off x="{v}" y="{v}"/><a:ext cx="{v}" cy="{v}"/>', s))
    edit("pptx", f"rot-{tag}", SLIDE, lambda s, v=v: s.replace("<a:xfrm>", f'<a:xfrm rot="{v}">', 1))
    edit("pptx", f"pptfontsize-{tag}", SLIDE, lambda s, v=v: s.replace("<a:r>", f'<a:r><a:rPr sz="{v}" spc="{v}" baseline="{v}"/>', 1).replace("<a:rPr/>", ""))
    edit("pptx", f"bodypr-{tag}", SLIDE, lambda s, v=v: s.replace("<a:bodyPr", f'<a:bodyPr lIns="{v}" tIns="{v}" rIns="{v}" bIns="{v}" numCol="{v}" spcCol="{v}"', 1))
    edit("pptx", f"lnspc-{tag}", SLIDE, lambda s, v=v: s.replace("<a:p>", f'<a:p><a:pPr marL="{v}" indent="{v}"><a:lnSpc><a:spcPct val="{v}"/></a:lnSpc><a:spcBef><a:spcPts val="{v}"/></a:spcBef></a:pPr>', 1))
    edit("pptx", f"line-width-{tag}", SLIDE, lambda s, v=v: s.replace("</p:spPr>", f'<a:ln w="{v}"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></p:spPr>', 1))
    edit("xlsx", f"row-{tag}", SHEET, sheet_data(f'<row r="{v}"><c r="A1"><v>1</v></c></row>'))
    edit("xlsx", f"rowht-{tag}", SHEET, sheet_data(f'<row r="1" ht="{v}" customHeight="1"><c r="A1"><v>1</v></c></row>'))
    edit("xlsx", f"colwidth-{tag}", SHEET, lambda s, v=v: s.replace("<sheetData", f'<cols><col min="1" max="{v}" width="{v}" customWidth="1"/></cols><sheetData', 1))
    edit("xlsx", f"value-{tag}", SHEET, sheet_data(f'<row r="1"><c r="A1" s="0"><v>{v}</v></c><c r="B1" t="s"><v>{v}</v></c><c r="C1" t="b"><v>{v}</v></c></row>'))
    edit("xlsx", f"style-index-{tag}", SHEET, sheet_data(f'<row r="1"><c r="A1" s="{v}"><v>1</v></c></row>'))
    edit("xlsx", f"freeze-{tag}", SHEET, lambda s, v=v: re.sub(r"<sheetView ([^>]*)/>", rf'<sheetView \1><pane xSplit="{v}" ySplit="{v}" topLeftCell="B2" state="frozen"/></sheetView>', s))
edit("pptx", "custgeom-many-points", SLIDE, lambda s: s.replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:custGeom><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>' + '<a:lnTo><a:pt x="100" y="100"/></a:lnTo>' * 200_000 + '</a:path></a:pathLst></a:custGeom>', 1))
edit("pptx", "custgeom-zero", SLIDE, lambda s: s.replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:custGeom><a:gdLst><a:gd name="g" fmla="*/ w 1 0"/><a:gd name="h2" fmla="?: g g g"/></a:gdLst><a:pathLst><a:path w="0" h="0"><a:moveTo><a:pt x="g" y="h2"/></a:moveTo><a:arcTo wR="g" hR="0" stAng="99999999999" swAng="-99999999999"/><a:close/></a:path></a:pathLst></a:custGeom>', 1))
edit("pptx", "prstgeom-adj-huge", SLIDE, lambda s: s.replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:prstGeom prst="star32"><a:avLst><a:gd name="adj" fmla="val 99999999999"/></a:avLst></a:prstGeom>', 1))
for prst in ("arc", "blockArc", "donut", "wave", "doubleWave", "gear9", "cloud", "chord", "pie", "leftRightRibbon"):
    edit("pptx", f"prst-{prst}-neg", SLIDE, lambda s, p=prst: s.replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', f'<a:prstGeom prst="{p}"><a:avLst><a:gd name="adj1" fmla="val -2147483648"/><a:gd name="adj2" fmla="val 2147483647"/><a:gd name="adj3" fmla="val 0"/></a:avLst></a:prstGeom>', 1))

# ---- tables in slides ----
TABLE = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="77" name="T"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid>{grid}</a:tblGrid>{rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
edit("pptx", "table-span-huge", SLIDE, sp_tree(TABLE.format(grid='<a:gridCol w="100"/>', rows='<a:tr h="100"><a:tc gridSpan="2147483647" rowSpan="2147483647"><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc></a:tr>')))
edit("pptx", "table-no-grid", SLIDE, sp_tree(TABLE.format(grid='', rows='<a:tr h="100">' + '<a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc>' * 5 + '</a:tr>')))
edit("pptx", "table-ragged", SLIDE, sp_tree(TABLE.format(grid='<a:gridCol w="100"/>' * 3, rows='<a:tr h="100"><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc></a:tr><a:tr h="100">' + '<a:tc hMerge="1" vMerge="1"/>' * 7 + '</a:tr>')))

# ---- relationships ----
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
edit("docx", "rel-to-self", "word/_rels/document.xml.rels", lambda s: s.replace("</Relationships>", f'<Relationship Id="rIdSelf" Type="{REL}header" Target="document.xml"/></Relationships>'))
edit("docx", "rel-missing-targets", "word/_rels/document.xml.rels", lambda s: re.sub(r'Target="[^"]+"', 'Target="nowhere.xml"', s))
edit("docx", "rel-parent-escape", "word/_rels/document.xml.rels", lambda s: re.sub(r'Target="styles.xml"', 'Target="../../../../../etc/passwd"', s))
edit("docx", "rel-absolute", "word/_rels/document.xml.rels", lambda s: re.sub(r'Target="styles.xml"', 'Target="/word/styles.xml"', s))
edit("docx", "rels-empty", "word/_rels/document.xml.rels", lambda s: "")
edit("docx", "main-rel-missing", "_rels/.rels", lambda s: re.sub(r'Target="word/document.xml"', 'Target="word/nothing.xml"', s))
edit("docx", "main-rel-external", "_rels/.rels", lambda s: s.replace('Target="word/document.xml"', 'Target="http://example.com/x.xml" TargetMode="External"'))
edit("docx", "basedon-cycle", "word/styles.xml", lambda s: s.replace("</w:styles>", '<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style><w:style w:type="character" w:styleId="C"><w:basedOn w:val="C"/><w:link w:val="A"/></w:style></w:styles>').replace("<w:p>", ""))
edit("docx", "uses-cyclic-style", DOC, lambda s: s.replace("<w:p>", '<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:rPr><w:rStyle w:val="C"/></w:rPr><w:t>cyc</w:t></w:r>', 1))
add_parts("docx", "basedon-cycle-used", [], [("word/styles.xml", lambda s: s.replace("</w:styles>", '<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/></w:style><w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/></w:style><w:style w:type="character" w:styleId="C"><w:basedOn w:val="C"/></w:style><w:style w:type="table" w:styleId="T"><w:basedOn w:val="T"/></w:style></w:styles>')), (DOC, lambda s: s.replace("<w:p>", '<w:p><w:pPr><w:pStyle w:val="A"/></w:pPr><w:r><w:rPr><w:rStyle w:val="C"/></w:rPr><w:t>cyc</w:t></w:r>', 1).replace("<w:tblPr>", '<w:tblPr><w:tblStyle w:val="T"/>', 1))])
NUMBERING = '<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:numStyleLink w:val="L1"/></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:styleLink w:val="L1"/><w:lvl w:ilvl="0"><w:start w:val="-2147483648"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2.%3.%4.%5.%6.%7.%8.%9.%10"/></w:lvl><w:lvl w:ilvl="99999"><w:numFmt w:val="upperRoman"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="2147483647"/></w:lvlOverride></w:num></w:numbering>'
add_parts(
    "docx",
    "numbering-hostile",
    [],
    [
        ("word/numbering.xml", lambda s: NUMBERING),
        ("word/styles.xml", lambda s: s.replace("</w:styles>", '<w:style w:type="numbering" w:styleId="L1"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style></w:styles>')),
        (DOC, lambda s: s.replace("<w:p>", "".join(f'<w:p><w:pPr><w:numPr><w:ilvl w:val="{l}"/><w:numId w:val="{n}"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>' for n in (1, 2, 3, 99999) for l in (0, 8, 9, 99999, -1)) + "<w:p>", 1)),
    ],
)
edit("pptx", "layout-rel-to-slide", "ppt/slides/_rels/slide1.xml.rels", lambda s: re.sub(r'Target="../slideLayouts/slideLayout\d+.xml"', 'Target="slide1.xml"', s))
edit("pptx", "layout-master-loop", "ppt/slideLayouts/_rels/slideLayout2.xml.rels", lambda s: re.sub(r'Target="../slideMasters/slideMaster1.xml"', 'Target="slideLayout2.xml"', s))
edit("pptx", "master-to-layout-loop", "ppt/slideMasters/_rels/slideMaster1.xml.rels", lambda s: s.replace("</Relationships>", f'<Relationship Id="rIdX" Type="{REL}slideMaster" Target="slideMaster1.xml"/></Relationships>'))
edit("pptx", "no-master", "ppt/_rels/presentation.xml.rels", lambda s: re.sub(r'<Relationship [^>]*slideMaster"[^>]*/>', "", s))
edit("pptx", "slide-listed-twice", "ppt/presentation.xml", lambda s: re.sub(r'(<p:sldId [^>]*/>)', r"\1\1\1", s))
edit("pptx", "slide-rel-missing", "ppt/_rels/presentation.xml.rels", lambda s: re.sub(r'Target="slides/slide1.xml"', 'Target="slides/none.xml"', s))
edit("pptx", "slide-rel-to-pres", "ppt/_rels/presentation.xml.rels", lambda s: re.sub(r'Target="slides/slide1.xml"', 'Target="presentation.xml"', s))
edit("pptx", "theme-colors-weird", "ppt/theme/theme1.xml", lambda s: re.sub(r'<a:srgbClr val="[0-9A-F]+"/>', '<a:srgbClr val="ZZZZZZZZZ"><a:lumMod val="-99999999"/><a:alpha val="99999999999"/><a:hueOff val="NaN"/></a:srgbClr>', s))
edit("pptx", "schemeclr-cycle", "ppt/slideMasters/slideMaster1.xml", lambda s: re.sub(r"<p:clrMap [^>]*/>", '<p:clrMap bg1="tx1" tx1="bg1" bg2="bg2" tx2="tx2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>', s))
edit("xlsx", "sheet-rel-missing", "xl/_rels/workbook.xml.rels", lambda s: s.replace("worksheets/sheet1.xml", "worksheets/none.xml"))
edit("xlsx", "sheet-rel-to-workbook", "xl/_rels/workbook.xml.rels", lambda s: s.replace("worksheets/sheet1.xml", "workbook.xml"))
edit("xlsx", "two-sheets-one-part", "xl/workbook.xml", lambda s: re.sub(r'(<sheet [^>]*/>)', r'\1<sheet name="Again" sheetId="9" r:id="rId1"/>', s))
edit("xlsx", "styles-missing", "xl/_rels/workbook.xml.rels", lambda s: s.replace('Target="styles.xml"', 'Target="nostyles.xml"'))

# ---- sheets ----
edit("xlsx", "cell-XFE", SHEET, sheet_data('<row r="1"><c r="XFE1"><v>1</v></c><c r="ZZZ1"><v>2</v></c></row>'))
edit("xlsx", "cell-no-r-many", SHEET, sheet_data("<row>" + "<c><v>1</v></c>" * 20_000 + "</row>"))
edit("xlsx", "cells-out-of-order", SHEET, sheet_data('<row r="5"><c r="C5"><v>3</v></c><c r="A5"><v>1</v></c></row><row r="2"><c r="B2"><v>2</v></c></row><row r="2"><c r="B2"><v>9</v></c></row>'))
edit("xlsx", "merge-whole-sheet", SHEET, lambda s: s.replace("</sheetData>", '</sheetData><mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>'))
edit("xlsx", "merges-overlapping", SHEET, lambda s: s.replace("</sheetData>", '</sheetData><mergeCells>' + "".join(f'<mergeCell ref="A{i}:Z{i + 50}"/>' for i in range(1, 20_000)) + "</mergeCells>"))
edit("xlsx", "merge-bad-refs", SHEET, lambda s: s.replace("</sheetData>", '</sheetData><mergeCells><mergeCell ref="B2:A1"/><mergeCell ref="ZZZ9999999:A1"/><mergeCell ref=":"/><mergeCell ref="A1"/></mergeCells>'))
edit("xlsx", "sheet-size-name-huge", "xl/workbook.xml", lambda s: s.replace("</workbook>", '<definedNames><definedName name="Writan.SheetSize" localSheetId="0" hidden="1">{4294967295,4294967295}</definedName></definedNames></workbook>').replace("<calcPr", "<calcPr") if "<definedNames>" not in s else s)
edit("xlsx", "defined-names-cycle", "xl/workbook.xml", lambda s: re.sub(r"(</sheets>)", r'\1<definedNames><definedName name="a">b</definedName><definedName name="b">a+1</definedName><definedName name="c">Sheet1!$A$1:$XFD$1048576</definedName></definedNames>', s))
edit("xlsx", "formula-uses-names", SHEET, sheet_data('<row r="1"><c r="A1"><f>a</f></c><c r="B1"><f>SUM(c)</f></c><c r="C1"><f>b*2</f></c></row>'))
edit("xlsx", "formula-circular", SHEET, sheet_data('<row r="1"><c r="A1"><f>B1+1</f></c><c r="B1"><f>A1+1</f></c><c r="C1"><f>C1</f></c></row>'))
edit("xlsx", "formula-chain-20000", SHEET, sheet_data('<row r="1"><c r="A1"><v>1</v></c></row>' + "".join(f'<row r="{r}"><c r="A{r}"><f>A{r - 1}+1</f></c></row>' for r in range(2, 20_001))))
edit("xlsx", "formula-chain-reversed-20000", SHEET, sheet_data("".join(f'<row r="{r}"><c r="A{r}"><f>A{r + 1}+1</f></c></row>' for r in range(1, 20_000)) + '<row r="20000"><c r="A20000"><v>1</v></c></row>'))
edit("xlsx", "formula-nested-parens", SHEET, sheet_data('<row r="1"><c r="A1"><f>' + "(" * 50_000 + "1" + ")" * 50_000 + "</f></c></row>"))
edit("xlsx", "formula-nested-calls", SHEET, sheet_data('<row r="1"><c r="A1"><f>' + "ABS(" * 20_000 + "1" + ")" * 20_000 + "</f></c></row>"))
edit("xlsx", "formula-unary-chain", SHEET, sheet_data('<row r="1"><c r="A1"><f>' + "-" * 100_000 + "1</f></c></row>"))
edit("xlsx", "formula-long-sum", SHEET, sheet_data('<row r="1"><c r="A1"><f>' + "+".join(["1"] * 200_000) + "</f></c></row>"))
edit("xlsx", "formula-power-chain", SHEET, sheet_data('<row r="1"><c r="A1"><f>' + "^".join(["2"] * 50_000) + "</f></c></row>"))
edit("xlsx", "formula-concat-chain", SHEET, sheet_data('<row r="1"><c r="A1"><f>' + "&amp;".join(['"ab"'] * 50_000) + "</f></c></row>"))
edit("xlsx", "formula-whole-columns", SHEET, sheet_data('<row r="1"><c r="A1"><f>SUM(B:XFD)</f></c><c r="B1"><f>SUMPRODUCT(C1:XFD1048576,C1:XFD1048576)</f></c><c r="C1"><f>COUNTIF(A:XFD,"&gt;0")</f></c><c r="D1"><f>VLOOKUP(1,A:XFD,16384,FALSE)</f></c><c r="E1"><f>INDEX(A:XFD,1048576,16384)</f></c></row>'))
edit("xlsx", "formula-rept-huge", SHEET, sheet_data('<row r="1"><c r="A1"><f>REPT("x",2147483647)</f></c><c r="B1"><f>REPT(REPT("ab",30000),30000)</f></c><c r="C1"><f>LEN(REPT("x",1E+300))</f></c></row>'))
edit("xlsx", "formula-functions-edge", SHEET, sheet_data('<row r="1"><c r="A1"><f>MID("abc",-1,2)</f></c><c r="B1"><f>LEFT("abc",-5)</f></c><c r="C1"><f>DATE(99999,99999,99999)</f></c><c r="D1"><f>TEXT(1E+308,"yyyy-mm-dd")</f></c><c r="E1"><f>CHAR(0)</f></c><c r="F1"><f>ROUND(1E+308,-400)</f></c><c r="G1"><f>MOD(1,0)</f></c><c r="H1"><f>FACT(170)*FACT(170)</f></c><c r="I1"><f>EDATE(1,2147483647)</f></c><c r="J1"><f>SUBSTITUTE("aaa","","b")</f></c><c r="K1"><f>FIND("",  "")</f></c><c r="L1"><f>RIGHT("é😀",1)</f></c><c r="M1"><f>OFFSET(A1,1048575,16383,99999,99999)</f></c><c r="N1"><f>INDIRECT("XFD1048576:A1")</f></c><c r="O1"><f>EOMONTH(-1,-99999)</f></c><c r="P1"><f>WEEKDAY(-1)</f></c><c r="Q1"><f>DATEDIF(1,0,"y")</f></c><c r="R1"><f>POWER(-1,0.5)</f></c><c r="S1"><f>LOG(0)</f></c><c r="T1"><f>FIXED(1E+308,127)</f></c></row>'))
edit("xlsx", "formula-garbage", SHEET, sheet_data('<row r="1"><c r="A1"><f>((((</f></c><c r="B1"><f>)))</f></c><c r="C1"><f>SUM(,,,,)</f></c><c r="D1"><f>A1:</f></c><c r="E1"><f>"unterminated</f></c><c r="F1"><f>{1,2;3}</f></c><c r="G1"><f>#REF!+#N/A</f></c><c r="H1"><f>Sheet9!A1</f></c><c r="I1"><f>[1]Sheet1!A1</f></c><c r="J1"><f>\'It\'\'s\'!A1</f></c><c r="K1"><f>A1048577</f></c><c r="L1"><f>XFE1</f></c><c r="M1"><f>1E+999</f></c><c r="N1"><f>%%%</f></c></row>'))
edit("xlsx", "shared-formula-bad", SHEET, sheet_data('<row r="1"><c r="A1"><f t="shared" ref="A1:A1048576" si="0">B1+1</f></c></row><row r="2"><c r="A2"><f t="shared" si="0"/></c><c r="B2"><f t="shared" si="99"/></c><c r="C2"><f t="shared" si="-1" ref="ZZ:ZZ">1</f></c></row>'))
edit("xlsx", "array-formula-huge", SHEET, sheet_data('<row r="1"><c r="A1"><f t="array" ref="A1:XFD1048576">1</f></c></row>'))
for fmt in ('0' * 5000, '#,##0.' + '0' * 400, ';' * 5000, '[Red]' * 5000, 'yyyy' * 3000, '"' + 'x' * 100_000 + '"', '0.00E+' + '0' * 300, '# ?/' + '?' * 400, '[h]:mm:ss' * 500, '[<-1E+308]0;[>1E+308]0', '@' * 1000, '\\' * 1001, '[$-F800]' * 1000, '*' * 5000, '_' * 5000):
    name = "numfmt-" + re.sub(r"[^a-z0-9]", "", fmt[:12].lower()) + str(len(fmt))
    edit("xlsx", name, "xl/styles.xml", lambda s, f=fmt: re.sub(r"<numFmts[^>]*>.*?</numFmts>|(?=<fonts)", f'<numFmts count="1"><numFmt numFmtId="164" formatCode="{f.replace(chr(34), "&quot;").replace("<", "&lt;").replace(">", "&gt;")}"/></numFmts>', s, count=1, flags=re.S).replace('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'))
for v in ("-1", "2958466", "1E+308", "-1E+308", "60", "0.9999999999999", "4.9E-324"):
    edit("xlsx", f"date-{v}", "xl/styles.xml", lambda s: s.replace('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', '<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'))
    with open(os.path.join(out, f"date-{v}.xlsx"), "rb") as f:
        BASES["_d"] = f.read()
    parts = [(n, (re.sub(r"<sheetData>.*</sheetData>", f'<sheetData><row r="1"><c r="A1" s="0"><v>{v}</v></c></row></sheetData>', d.decode(), flags=re.S).encode() if n == SHEET else d)) for n, d in parts_of(BASES["_d"])]
    raw(f"date-{v}.xlsx", rezip(parts))
edit("xlsx", "date1904-negative", "xl/workbook.xml", lambda s: s.replace("<workbookPr", '<workbookPr date1904="1"', 1) if "<workbookPr" in s else s.replace("<sheets>", '<workbookPr date1904="1"/><sheets>'))
edit("xlsx", "inline-and-rich", SHEET, sheet_data('<row r="1"><c r="A1" t="inlineStr"><is><r><rPr><sz val="99999"/><color rgb="ZZ"/></rPr><t>rich</t></r><r><t xml:space="preserve"> text </t></r><rPh sb="0" eb="99"><t>x</t></rPh></is></c><c r="B1" t="inlineStr"><is/></c><c r="C1" t="inlineStr"/></row>'))
edit("xlsx", "cf-dv-huge", SHEET, lambda s: s.replace("</sheetData>", '</sheetData><conditionalFormatting sqref="A1:XFD1048576"><cfRule type="expression" dxfId="999" priority="1"><formula>' + "(" * 5000 + "1" + ")" * 5000 + '</formula></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="list" sqref="A1:XFD1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>'))

# ---- zips ----
raw("empty.docx", b"")
raw("random.xlsx", os.urandom(4096))
raw("pdf-renamed.docx", b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
raw("png-renamed.pptx", b"\x89PNG\r\n\x1a\n" + os.urandom(100))
raw("text-renamed.xlsx", b"hello, world\n1,2\n")
raw("zip-empty.docx", rezip([]))
raw("zip-no-content-types.docx", rezip([(n, d) for n, d in parts_of(BASES["docx"]) if n != "[Content_Types].xml"]))
raw("zip-only-content-types.xlsx", rezip([(n, d) for n, d in parts_of(BASES["xlsx"]) if n == "[Content_Types].xml"]))
raw("zip-truncated-half.pptx", BASES["pptx"][: len(BASES["pptx"]) // 2])
raw("zip-truncated-tail.docx", BASES["docx"][:-10])
for k in ("docx", "pptx", "xlsx"):
    raw(f"zip-thousands-of-entries.{k}", rezip(parts_of(BASES[k]) + [(f"junk/{i}.bin", b"x") for i in range(30_000)]))
    raw(f"zip-duplicate-entries.{k}", BASES[k] + b"")  # (python's zipfile won't write duplicates; see below)

# A zip bomb: one part that inflates to 3 GB of spaces, and a deck whose slide inflates to 1 GB.
def bomb(kind, part, size, fill=b" "):
    parts = parts_of(BASES[kind])
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for n, d in parts:
            if n == part:
                info = zipfile.ZipInfo(n)
                info.compress_type = zipfile.ZIP_DEFLATED
                with z.open(info, "w", force_zip64=True) as w:
                    w.write(d[: d.rindex(b"<")])
                    chunk = fill * (1 << 20)
                    for _ in range(size >> 20):
                        w.write(chunk)
                    w.write(d[d.rindex(b"<"):])
            else:
                z.writestr(n, d)
    return b.getvalue()


raw("bomb-3gb-styles.docx", bomb("docx", "word/styles.xml", 3 << 30))
raw("bomb-1gb-slide.pptx", bomb("pptx", SLIDE, 1 << 30))
raw("bomb-600mb-sheet.xlsx", bomb("xlsx", SHEET, 600 << 20))
raw("bomb-200mb-text.docx", bomb("docx", DOC, 200 << 20, b"x"))
