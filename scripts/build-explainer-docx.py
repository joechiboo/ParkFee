# 抽籤辦法說明表 Word 版（A4 橫式）——給經理／主委改字用。
#
# 內容來源＝docs/35-抽籤辦法說明表-A4橫式.html（文字不在本檔維護）；
# 流程圖與 QR 由同名 PDF 裁成 300dpi 圖片（Word 不吃 inline SVG），所以流程圖內的字在 Word 裡改不了，
# 要改流程圖請改 html 重產。其餘文字（抬頭、四階段說明、署名）都是可編輯文字。
# 流程圖整張跨四列（不切段：免抽籤匯流線就貼在階段分界上，切開會斷）；列高用「最小值」，
# 經理加字時列會長高、不會被裁掉，但流程圖的階段虛線會和表格橫線錯開，字加多了請改 html 重產。
#
# ⚠️ Word 頁面上限約 55.87cm，開不了 A0；A0 海報請用 PDF（docs/pdf/35-抽籤辦法說明表-A0橫式.pdf）。
#
# 前置：node scripts/build-docs-pdf.mjs docs/35-抽籤辦法說明表-A4橫式.html
# 用法：python scripts/build-explainer-docx.py [輸出.docx]
import html as htmllib
import io
import re
import sys

import fitz
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_ALIGN_VERTICAL, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

SRC_HTML = 'docs/35-抽籤辦法說明表-A4橫式.html'
SRC_PDF = 'docs/pdf/35-抽籤辦法說明表-A4橫式.pdf'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/35-抽籤辦法說明表-A4橫式.docx'

FONT = 'Microsoft JhengHei'
KAI = '標楷體'
BLUE = RGBColor(0x1D, 0x5F, 0xA8)
RED = RGBColor(0xC1, 0x12, 0x1F)
SEAL_RED = RGBColor(0xCC, 0x00, 0x00)
GREY = RGBColor(0x66, 0x66, 0x66)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
PHASES = ['1登記', '2抽籤', '3簽約繳費', '4使用']
ROW_RATIO = [198, 155, 151, 86]  # 與 html 列高同比例，流程圖的階段虛線才對得上表格橫線
ROW_PAD = [4.5, 8.1, 8.1, 7.5]  # pt，Word COM 實測校正


def set_font(run, size, bold=None, color=None, font=FONT):
    run.font.name = font
    run.font.size = Pt(size)
    run._element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'), font)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def tight(par, line=None, before=0, after=0):
    fmt = par.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    if line:
        fmt.line_spacing_rule = WD_LINE_SPACING.EXACTLY
        fmt.line_spacing = Pt(line)
    else:
        fmt.line_spacing = 1.0


# tcPr 子元素有固定順序（CT_TcPr），亂序 Word 可能忽略設定
TCPR_ORDER = ['w:tcW', 'w:gridSpan', 'w:vMerge', 'w:tcBorders', 'w:shd', 'w:noWrap', 'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign']


def cell_prop(cell, tag, **attrs):
    tcPr = cell._tc.get_or_add_tcPr()
    el = OxmlElement(tag)
    for k, v in attrs.items():
        el.set(qn(f'w:{k}'), str(v))
    later = {qn(t) for t in TCPR_ORDER[TCPR_ORDER.index(tag) + 1:]}
    for child in tcPr:
        if child.tag in later:
            child.addprevious(el)
            return el
    tcPr.append(el)
    return el


def cell_margins(cell, **sides):
    mar = cell_prop(cell, 'w:tcMar')
    for side, pt in sides.items():
        el = OxmlElement(f'w:{side}')
        el.set(qn('w:w'), str(int(pt * 20)))
        el.set(qn('w:type'), 'dxa')
        mar.append(el)


def cell_borders(cell, color='777777', size=6, **sides):
    # sides: top/left/bottom/right = True（畫線）或 False（無線）
    bd = cell_prop(cell, 'w:tcBorders')
    for side in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement(f'w:{side}')
        on = sides.get(side, False)
        el.set(qn('w:val'), 'single' if on else 'nil')
        if on:
            el.set(qn('w:sz'), str(size))
            el.set(qn('w:color'), color)
        bd.append(el)


def fix_table(table, widths):
    # 固定欄寬，Word 才不會依內容自動撐開
    tblPr = table._tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    table.autofit = False
    for gc, w in zip(table._tbl.tblGrid.findall(qn('w:gridCol')), widths):
        gc.set(qn('w:w'), str(int(w * 20)))
    for row in table.rows:
        for cell, w in zip(row.cells, widths):
            cell.width = Pt(w)


def inline_runs(par, frag, size, base_color=None, base_bold=False):
    # 只處理 html 說明欄會出現的 <b> 與 <br>
    for tok in re.split(r'(<b>.*?</b>|<br\s*/?>)', frag, flags=re.S):
        if not tok:
            continue
        if tok.startswith('<br'):
            par.add_run().add_break()
            continue
        bold = tok.startswith('<b>')
        text = htmllib.unescape(re.sub(r'<[^>]+>', '', tok))
        text = re.sub(r'\s+', ' ', text)
        if not text:
            continue
        color = base_color if base_color is not None else (BLUE if bold else None)
        set_font(par.add_run(text), size, bold=bold or base_bold, color=color)


def blank(par, n, size):
    # 留白填寫處：底線空格（全形底線在 Word 會變虛線）
    run = par.add_run('\u00a0' * n)
    set_font(run, size)
    run.font.underline = True


def fill_desc(cell, frag):
    # frag：一個 .desc 區塊的 html（p / ol>li）
    size, line = 9.5, 14
    first = True
    n = 0
    for m in re.finditer(r'<(p|li)((?:\s[^>]*)?)>(.*?)</\1>', frag, flags=re.S):
        tag, attrs, body = m.groups()
        par = cell.paragraphs[0] if first else cell.add_paragraph()
        first = False
        tight(par, line=line, after=2)
        warn = 'warn' in attrs
        kw = {'base_color': RED, 'base_bold': True} if warn else {}
        if tag == 'li':
            n += 1
            par.paragraph_format.left_indent = Pt(24)
            par.paragraph_format.first_line_indent = Pt(-13)
            set_font(par.add_run(f'{n}. '), size, bold=warn or None, color=RED if warn else None)
        inline_runs(par, body, size, **kw)


def picture_bytes(page, rect, dpi=300):
    buf = io.BytesIO(page.get_pixmap(dpi=dpi, clip=rect).tobytes('png'))
    buf.seek(0)
    return buf


def locate(page):
    # 版面座標從 PDF 取：sheet 外框、流程欄、QR 框
    rects = [d['rect'] for d in page.get_drawings()]
    flow = next(r for r in rects if r.height > 300 and 150 < r.width < 300)
    right = page.rect.width
    qr = max(
        (r for r in rects if r.x0 > flow.x1 + 300 and r.height > 100 and r.width < 200),
        key=lambda r: r.width * r.height,
    )
    return flow, fitz.Rect(qr.x0 - 2, qr.y0 - 2, min(qr.x1 + 2, right), qr.y1 + 2)


def main():
    src = open(SRC_HTML, encoding='utf-8').read()
    descs = re.findall(r'<div class="desc(?: r1)?">(.*?)</div>\s*(?=\n)', src, flags=re.S)
    if len(descs) != 4:
        raise SystemExit(f'預期 4 段說明，實得 {len(descs)}')
    subj = re.search(r'<div class="subj">主旨：<b>(.*?)</b><span class="sub">(.*?)</span>', src)
    basis = htmllib.unescape(re.search(r'<p class="basis">(.*?)</p>', src).group(1))
    org = re.search(r'<div class="n">(樂菲.*?)</div>\s*<div class="p">(.*?)</div>', src, flags=re.S)
    if not (subj and org):
        raise SystemExit('html 抬頭或署名結構變了，請更新本腳本')

    pdf = fitz.open(SRC_PDF)
    page = pdf[0]
    flow_rect, qr_rect = locate(page)

    doc = Document()
    sec = doc.sections[0]
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width, sec.page_height = Pt(841.9), Pt(595.3)
    sec.left_margin = sec.right_margin = Pt(36)
    sec.top_margin = sec.bottom_margin = Pt(30)
    sec.header_distance = sec.footer_distance = Pt(0)
    usable = 841.9 - 72
    grid = sec._sectPr.find(qn('w:docGrid'))
    if grid is not None:  # 預設範本的行距格線會把表格列撐高
        sec._sectPr.remove(grid)

    # ── 抬頭 ──
    head = doc.add_table(rows=1, cols=3)
    head_w = [120, 300, usable - 420]
    fix_table(head, head_w)
    a, b, c = head.rows[0].cells
    for cell in (a, b, c):
        cell.vertical_alignment = WD_ALIGN_VERTICAL.BOTTOM
    par = a.paragraphs[0]
    tight(par)
    set_font(par.add_run('公　告'), 28, bold=True, color=SEAL_RED, font=KAI)
    par = b.paragraphs[0]
    tight(par)
    set_font(par.add_run('中華民國 115 年 '), 9)
    blank(par, 6, 9)
    set_font(par.add_run(' 月 '), 9)
    blank(par, 6, 9)
    set_font(par.add_run(' 日　樂菲（管）字第：'), 9)
    blank(par, 16, 9)
    set_font(par.add_run(' 號'), 9)
    par = b.add_paragraph()
    tight(par)
    set_font(par.add_run('公告期間：'), 9)
    blank(par, 6, 9)
    set_font(par.add_run(' 月 '), 9)
    blank(par, 6, 9)
    set_font(par.add_run(' 日至 11 月 30 日'), 9)
    par = c.paragraphs[0]
    tight(par)
    par.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_font(par.add_run('主旨：'), 11)
    set_font(par.add_run(htmllib.unescape(subj.group(1))), 12.5, bold=True, color=SEAL_RED)
    par = c.add_paragraph()
    tight(par)
    par.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    set_font(par.add_run(htmllib.unescape(subj.group(2))), 9.5, color=GREY)

    spacer = doc.add_paragraph()
    tight(spacer, line=5)

    # ── 主表：階段｜流程圖｜說明｜(間隔)｜QR＋署名 ──
    flow_w = 205.0
    flow_h = flow_w * flow_rect.height / flow_rect.width
    widths = [23, flow_w, usable - 23 - flow_w - 8 - 150, 8, 150]
    total = sum(ROW_RATIO)
    # Word 實際列高會比設定值多一截，依 ROW_PAD 扣掉，階段虛線才對得上表格橫線
    heights = [flow_h * r / total - p for r, p in zip(ROW_RATIO, ROW_PAD)]

    sheet = doc.add_table(rows=4, cols=5)
    fix_table(sheet, widths)
    for row, h in zip(sheet.rows, heights):
        row.height = Pt(h)
        row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST

    for i, (row, phase) in enumerate(zip(sheet.rows, PHASES)):
        ph, _, desc, gap, _ = row.cells
        cell_prop(ph, 'w:shd', val='clear', color='auto', fill='1D5FA8')
        ph.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        cell_margins(ph, left=0, right=0, top=0, bottom=0)
        cell_borders(ph, top=True, left=True, bottom=True, right=False)
        par = ph.paragraphs[0]
        tight(par, line=15)
        par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_font(par.add_run(phase[0]), 9.5, bold=True, color=WHITE)
        for ch in phase[1:]:
            par = ph.add_paragraph()
            tight(par, line=15)
            par.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_font(par.add_run(ch), 10.5, bold=True, color=WHITE)

        cell_margins(desc, left=8, right=6, top=5, bottom=2)
        cell_borders(desc, top=True, left=True, bottom=True, right=True)
        fill_desc(desc, descs[i])
        cell_borders(gap)
        tight(gap.paragraphs[0], line=1)

    # 合併的延續格留有空段落，先壓到最小，否則會把列撐高
    for col in (1, 4):
        for r in range(4):
            tight(sheet.cell(r, col).paragraphs[0], line=1)

    # 流程圖：跨四列合併，靠上對齊
    flow_cell = sheet.cell(0, 1).merge(sheet.cell(3, 1))
    flow_cell.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    cell_prop(flow_cell, 'w:shd', val='clear', color='auto', fill='FBFCFE')
    cell_margins(flow_cell, left=0, right=0, top=0, bottom=0)
    cell_borders(flow_cell, top=True, left=True, bottom=True, right=True)
    for extra in flow_cell.paragraphs[1:]:
        extra._p.getparent().remove(extra._p)
    par = flow_cell.paragraphs[0]
    tight(par)
    par.add_run().add_picture(picture_bytes(page, flow_rect), width=Pt(flow_w))

    # 右欄：QR（圖含框線與文字）、章位留白、署名
    aside = sheet.cell(0, 4).merge(sheet.cell(3, 4))
    aside.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    cell_margins(aside, left=0, right=0, top=0, bottom=0)
    cell_borders(aside)
    par = aside.paragraphs[0]
    tight(par)
    par.alignment = WD_ALIGN_PARAGRAPH.CENTER
    par.add_run().add_picture(picture_bytes(page, qr_rect), width=Pt(148))
    par = aside.add_paragraph()
    tight(par, line=110)  # 紅章位
    par = aside.add_paragraph()
    tight(par)
    par.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(par.add_run(htmllib.unescape(org.group(1).strip())), 13, bold=True)
    par = aside.add_paragraph()
    tight(par, after=4)
    par.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(par.add_run(htmllib.unescape(org.group(2).strip())), 10)

    par = doc.add_paragraph()
    tight(par, before=3)
    set_font(par.add_run(basis), 8.5, color=GREY)

    doc.core_properties.title = '116 年度機車／自行車車位抽籤辦法說明表'
    doc.core_properties.author = '樂菲莊園管理委員會'
    doc.save(OUT)
    print('wrote', OUT.encode('ascii', 'backslashreplace').decode(), 'flow', round(flow_w), 'x', round(flow_h))


if __name__ == '__main__':
    main()
