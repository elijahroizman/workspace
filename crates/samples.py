#!/usr/bin/env python3
"""Makes sample files for the office compiler's round-trip tests.

    python3 crates/samples.py /tmp/office-samples
    OFFICE_SAMPLES=/tmp/office-samples cargo test   (in crates/)

Needs python-docx, python-pptx and openpyxl. If LibreOffice (soffice) is on the PATH, it also
saves LibreOffice's own versions of each file into lo/, since it writes them differently.
"""
import os
import shutil
import subprocess
import sys

import docx
import openpyxl
import pptx
from docx.shared import Pt, RGBColor
from pptx.util import Inches

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
d = docx.Document()
d.core_properties.title = "Sample"; d.core_properties.author = "Ada"
d.add_heading("Hello & welcome", 1)
p = d.add_paragraph("Plain ")
r = p.add_run("bold red"); r.bold = True; r.font.color.rgb = RGBColor(0xC0,0,0); r.font.size = Pt(14)
p.add_run(" and ").italic = True
p.add_run("italic").italic = True
t = d.add_table(rows=2, cols=3)
for i in range(2):
    for j in range(3):
        t.cell(i,j).text = f"r{i}c{j}"
d.add_paragraph("Bullet", style="List Bullet")
d.save(f"{out}/pydocx.docx")
pr = pptx.Presentation()
s = pr.slides.add_slide(pr.slide_layouts[1])
s.shapes.title.text = "Title slide"
s.placeholders[1].text = "First point\nSecond point"
tb = s.shapes.add_textbox(Inches(1), Inches(5), Inches(4), Inches(1))
tb.text_frame.text = "A text box"
tb.text_frame.paragraphs[0].runs[0].font.bold = True
s2 = pr.slides.add_slide(pr.slide_layouts[5])
s2.shapes.title.text = "Table"
gt = s2.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(6), Inches(2)).table
gt.cell(0,0).text = "a"; gt.cell(1,1).text = "d"
pr.save(f"{out}/pypptx.pptx")
wb = openpyxl.Workbook()
ws = wb.active; ws.title = "Data"
ws.append(["Name", "Qty", "Price", "Ok"])
ws.append(["Apple", 3, 1.25, True])
ws.append(["Pear", 5, 0.5, False])
ws["E2"] = "=B2*C2"
ws.merge_cells("A5:C5"); ws["A5"] = "merged"
wb.create_sheet("Second")["B3"] = "hello"
wb.save(f"{out}/openpyxl.xlsx")
with open(f"{out}/sample.csv", "w", newline="") as f:
    f.write('name,qty,note\r\n"Smith, J",3,"said ""hi"""\r\nLee,4,\r\n')

if shutil.which("soffice"):
    lo = os.path.join(out, "lo")
    run = lambda *args: subprocess.run(["soffice", "--headless", *args], cwd=out, check=True, capture_output=True, timeout=300)
    # Through .odt, so the .docx is written by LibreOffice rather than passed through.
    run("--convert-to", "odt", "pydocx.docx")
    run("--convert-to", "docx:MS Word 2007 XML", "--outdir", lo, "pydocx.odt")
    os.remove(os.path.join(out, "pydocx.odt"))
    for name in ("pypptx.pptx", "openpyxl.xlsx", "sample.csv"):
        run("--convert-to", "xlsx" if name.endswith((".xlsx", ".csv")) else "pptx", "--outdir", lo, name)
