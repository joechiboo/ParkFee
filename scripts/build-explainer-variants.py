# 由經理版說明表 Word 產出有空白行的版本（2026-11-04 定）：
# 右欄改 11.5pt、項目間留白、黑字全粗體（經理手動斷行的段落先接回，字變小才不會斷在句中）。
# 流程圖來源 docs/assets/35-流程圖.svg；列高固定，虛線才對得上表格橫線。
#
# 用法：python scripts/build-explainer-variants.py <經理版.docx> <輸出資料夾> [--seal]
#   --seal：署名兩側加社區公章與公告章（private/seals/，檔名加「-加章」；含電子章，只能放 private/）
import copy
import subprocess
import sys
import tempfile
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.shared import Pt, RGBColor

# pt；Word 另加 7.8pt（儲存格上下邊距與框線），實際列高 184／120／93／107，svg 虛線依實際值
ROW_HEIGHTS = [176.2, 112.2, 85.2, 99.2]
DESC_COL = 2
RED = RGBColor(0xC1, 0x12, 0x1F)
B_SIZE = 11.5
B_LINE = 14
B_GAP = 9.5
OUTPUT = '35-抽籤辦法說明表-A4橫式-11-4v6-署名置中.docx'
SIGNATURE = [('樂菲莊園管理委員會', 14), ('電話 02-2218-6136', 12)]
# 印章：格式同社區公告「[公章] 署名／電話 [公告章]」。原尺寸（82×83、132×90pt）放不進最後一列
# 上方兩行字以下的空間，會壓到紅字與 QR，所以縮成 SEAL_SCALE；圖檔每 pt 6 像素（同 extract-seals.mjs）
SEAL_SCALE = 0.65
SEAL_GAP = 10  # 印章與署名的間距（pt）
SEAL_BOTTOM = 97  # 印章下緣距最後一列內容頂端（pt），列內高約 100
SEALS = [('private/seals/seal-committee.png', 'left'), ('private/seals/seal-notice.png', 'right')]
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
    # 11/04 主委要求：最後一列署名，格式同經理版（管委會／電話兩行）。在右欄正中間，寬度碰不到 QR
    cell = table.rows[-1].cells[DESC_COL]
    sample = next(r for r in cell.paragraphs[0].runs if r.text and r.font.color.rgb is None)
    for i, (text, size) in enumerate(SIGNATURE):
        par = cell.add_paragraph()
        pf = par.paragraph_format
        pf.alignment = WD_ALIGN_PARAGRAPH.CENTER
        pf.space_before = Pt(28 if i == 0 else 0)
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


def seals(table):
    # 浮動圖片（不占行高）錨在最後一列第一段，水平以儲存格內文左緣、垂直以該段頂端為基準（同 QR）
    from PIL import Image
    cell = table.rows[-1].cells[DESC_COL]
    anchor_par = cell.paragraphs[0]
    # 署名的「置中」是在 QR 左邊的空間置中（QR 文繞圖），範圍＝QR 水平位移扣掉它的左側間距
    qr = cell._tc.find('.//' + qn('wp:anchor'))
    width = (int(qr.find(qn('wp:positionH')).find(qn('wp:posOffset')).text) - int(qr.get('distL'))) / 12700
    name_half = SIGNATURE[0][1] * len(SIGNATURE[0][0]) / 2
    emu = lambda pt: int(pt * 12700)
    for path, side in SEALS:
        px_w, px_h = Image.open(path).size
        w, h = px_w / 6 * SEAL_SCALE, px_h / 6 * SEAL_SCALE
        x = width / 2 - name_half - SEAL_GAP - w if side == 'left' else width / 2 + name_half + SEAL_GAP
        inline = anchor_par.add_run().add_picture(path, width=Pt(w))._inline
        anchor = parse_xml(
            f'<wp:anchor {nsdecls("wp")} distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251660300" '
            'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>'
            f'<wp:positionH relativeFrom="column"><wp:posOffset>{emu(x)}</wp:posOffset></wp:positionH>'
            f'<wp:positionV relativeFrom="paragraph"><wp:posOffset>{emu(SEAL_BOTTOM - h)}</wp:posOffset></wp:positionV></wp:anchor>'
        )
        anchor.append(inline.find(qn('wp:extent')))
        anchor.append(parse_xml(f'<wp:effectExtent {nsdecls("wp")} l="0" t="0" r="0" b="0"/>'))
        anchor.append(parse_xml(f'<wp:wrapNone {nsdecls("wp")}/>'))
        for tag in ('wp:docPr', 'wp:cNvGraphicFramePr', 'a:graphic'):
            anchor.append(inline.find(qn(tag)))
        inline.getparent().replace(inline, anchor)


def build(src, out_dir, seal=False):
    doc = Document(src)
    table = doc.tables[0]
    set_row_heights(table)
    red_etag(table)
    spaced(table)
    signature(table)
    if seal:
        seals(table)
    flow_bottom_border(table)
    tail = doc.paragraphs[-1].paragraph_format  # 表格後的空段落縮到最小，否則被擠到第二頁
    tail.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    tail.line_spacing = Pt(1)
    tail.space_before = Pt(0)
    with tempfile.TemporaryDirectory() as tmp:
        mid = Path(tmp) / 'mid.docx'
        doc.save(mid)
        out = Path(out_dir) / (OUTPUT.replace('.docx', '-加章.docx') if seal else OUTPUT)
        subprocess.run([sys.executable, 'scripts/build-explainer-flow.py', str(mid), str(out)], check=True)


def main(src, out_dir, seal=False):
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    build(src, out_dir, seal)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if a != '--seal']
    if len(args) != 2:
        raise SystemExit('用法：python scripts/build-explainer-variants.py <經理版.docx> <輸出資料夾> [--seal]')
    main(args[0], args[1], '--seal' in sys.argv)
