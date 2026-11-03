# 把 docs/assets/35-流程圖.svg 畫成圖，換掉說明表 Word 版裡的流程圖（其餘內容一字不動）。
#
# Word 版的文字以經理版為準（html 已落後），流程圖在 Word 裡改不了，所以改流程圖＝改 svg 後跑這支。
# 經理加字使表格列高改變時，svg 裡三條虛線的 y 要重量，才會對齊表格橫線。
#
# 用法：python scripts/build-explainer-flow.py <經理版.docx> <輸出.docx>
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
SVG = Path('docs/assets/35-流程圖.svg')
SCALE = 6  # 205pt 寬 × 6＝1230px，約 432dpi


def render(png):
    svg = SVG.read_text(encoding='utf-8')
    w, h = map(float, re.search(r'viewBox="0 0 (\S+) (\S+)"', svg).groups())
    px_w, px_h = round(w * SCALE), round(h * SCALE)
    sized = svg.replace('<svg ', f'<svg width="{px_w}" height="{px_h}" style="display:block" ', 1)
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / 'flow.html'
        page.write_text(f'<!doctype html><meta charset="utf-8"><body style="margin:0">{sized}', encoding='utf-8')
        subprocess.run(
            [EDGE, '--headless', '--disable-gpu', '--hide-scrollbars', f'--window-size={px_w},{px_h}',
             f'--user-data-dir={tmp}\\profile', f'--screenshot={png}', page.as_uri()],
            check=True, capture_output=True, timeout=120,
        )
    return w, h


def main(src, out):
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / 'flow.png'
        w, h = render(png)
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zout:
            doc = zin.read('word/document.xml').decode('utf-8')
            rels = zin.read('word/_rels/document.xml.rels').decode('utf-8')
            # 流程圖＝文件裡第一張 inline 圖（QR 是 anchor）
            m = re.search(r'<wp:inline .*?</wp:inline>', doc, flags=re.S)
            if not m:
                raise SystemExit('找不到 inline 圖')
            rid = re.search(r'r:embed="(\w+)"', m.group(0)).group(1)
            rel = next(r for r in re.findall(r'<Relationship [^>]*>', rels) if f'Id="{rid}"' in r)
            media = 'word/' + re.search(r'Target="([^"]+)"', rel).group(1)
            cx = int(re.search(r'<wp:extent cx="(\d+)"', m.group(0)).group(1))
            cy = round(cx * h / w)
            block = re.sub(r'(<wp:extent cx="\d+" cy=")\d+', rf'\g<1>{cy}', m.group(0))
            block = re.sub(r'(<a:ext cx="\d+" cy=")\d+', rf'\g<1>{cy}', block)
            doc = doc.replace(m.group(0), block)
            for item in zin.infolist():
                if item.filename == 'word/document.xml':
                    zout.writestr(item, doc.encode('utf-8'))
                elif item.filename == media:
                    zout.writestr(item, png.read_bytes())
                else:
                    zout.writestr(item, zin.read(item.filename))
    print('wrote', out, 'media', media, 'cy', cy)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('用法：python scripts/build-explainer-flow.py <經理版.docx> <輸出.docx>')
    main(sys.argv[1], sys.argv[2])
