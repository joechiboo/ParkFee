# 由經理版說明表 Word 產出有空白行的版本（2026-11-04 定）：
# 右欄改 11.5pt、項目間留白、黑字全粗體（經理手動斷行的段落先接回，字變小才不會斷在句中）。
# 流程圖來源 docs/assets/35-流程圖.svg；列高固定，虛線才對得上表格橫線。
#
# 用法：python scripts/build-explainer-variants.py <經理版.docx> <輸出資料夾>
import copy
import subprocess
import sys
import tempfile
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

# pt；Word 另加 7.8pt（儲存格上下邊距與框線），實際列高 184／120／93／107，svg 虛線依實際值
ROW_HEIGHTS = [176.2, 112.2, 85.2, 99.2]
DESC_COL = 2
RED = RGBColor(0xC1, 0x12, 0x1F)
B_SIZE = 11.5
B_LINE = 14
B_GAP = 9.5
OUTPUT = '35-抽籤辦法說明表-A4橫式-11-4v4-有空白.docx'
SIGNATURE = [('樂菲莊園管理委員會', 14), ('電話 02-2218-6136', 12)]
# 經理以空白手動斷行、要接回前一段的段落開頭
CONTINUATIONS = ('由秘書協助登記', '序、免抽籤', '驗證明後指派', '位再行安排處理')


def set_row_heights(table):
    for row, h in zip(table.rows, ROW_HEIGHTS):
        row.height = Pt(h)


def desc_paragraphs(table):
    for row in table.rows:
        yield from row.cells[DESC_COL].paragraphs


def red_etag(table):
    for par in desc_paragraphs(table):
        if 'eTag' in par.text:
            for run in par.runs:
                run.font.color.rgb = RED
                run.bold = True
            return
    raise SystemExit('找不到 eTag 那行')


def flow_bottom_border(table):
    # 流程圖是跨列合併，下框線看最後一列的延續格；經理版該格沒設，所以框線不見
    tc = table._tbl.tr_lst[-1].tc_lst[1]
    tc_pr = tc.get_or_add_tcPr()
    borders = OxmlElement('w:tcBorders')
    tc_pr.find(qn('w:vMerge')).addnext(borders)  # tcPr 子元素有固定順序
    bottom = OxmlElement('w:bottom')
    borders.append(bottom)
    for key, val in (('val', 'single'), ('sz', '6'), ('space', '0'), ('color', '777777')):
        bottom.set(qn(f'w:{key}'), val)


def signature(table):
    # 11/04 主委要求：最後一列 QR 左側署名，格式同經理版（管委會／電話兩行置中）。右縮排讓開 QR
    cell = table.rows[-1].cells[DESC_COL]
    sample = next(r for r in cell.paragraphs[0].runs if r.text and r.font.color.rgb is None)
    for i, (text, size) in enumerate(SIGNATURE):
        par = cell.add_paragraph()
        pf = par.paragraph_format
        pf.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pf.left_indent = Pt(276)
        pf.right_indent = Pt(112)
        pf.space_before = Pt(14 if i == 0 else 0)
        pf.space_after = Pt(0)
        pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        pf.line_spacing = Pt(size + 3)
        par._p.append(copy.deepcopy(sample._r))
        run = par.runs[0]
        run.text = text
        run.font.size = Pt(size)
        size_cs = run._r.rPr.find(qn('w:szCs'))
        if size_cs is not None:
            size_cs.set(qn('w:val'), str(size * 2))


def join_manual_breaks(table):
    for row in table.rows:
        pars = row.cells[DESC_COL].paragraphs
        for prev, cur in zip(pars, pars[1:]):
            if not cur.text.strip().startswith(CONTINUATIONS):
                continue
            for run in prev.runs:  # 斷行前的補位空白
                if not run.text.strip():
                    run.text = ''
            prev.runs[-1].text = prev.runs[-1].text.rstrip()
            for run in cur.runs:
                if not run.text.strip():
                    run.text = ''
                prev._p.append(run._r)
            cur._p.getparent().remove(cur._p)


def spaced(table):
    join_manual_breaks(table)
    for row in table.rows:
        row.cells[DESC_COL].paragraphs[-1].paragraph_format.space_after = Pt(0)
    for par in desc_paragraphs(table):
        pf = par.paragraph_format
        pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        pf.line_spacing = Pt(B_LINE)
        if pf.space_after != Pt(0):
            pf.space_after = Pt(B_GAP)
        for run in par.runs:
            if run.font.color.rgb in (None, RGBColor(0, 0, 0)):
                run.bold = True
            if run.font.size:
                run.font.size = Pt(B_SIZE)
                size_cs = run._r.rPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}szCs')
                if size_cs is not None:
                    size_cs.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', str(int(B_SIZE * 2)))


def build(src, out_dir):
    doc = Document(src)
    table = doc.tables[0]
    set_row_heights(table)
    red_etag(table)
    spaced(table)
    signature(table)
    flow_bottom_border(table)
    tail = doc.paragraphs[-1].paragraph_format  # 表格後的空段落縮到最小，否則被擠到第二頁
    tail.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    tail.line_spacing = Pt(1)
    tail.space_before = Pt(0)
    with tempfile.TemporaryDirectory() as tmp:
        mid = Path(tmp) / 'mid.docx'
        doc.save(mid)
        out = Path(out_dir) / OUTPUT
        subprocess.run([sys.executable, 'scripts/build-explainer-flow.py', str(mid), str(out)], check=True)


def main(src, out_dir):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    build(src, out_dir)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('用法：python scripts/build-explainer-variants.py <經理版.docx> <輸出資料夾>')
    main(sys.argv[1], sys.argv[2])
