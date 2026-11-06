# 說明表 A4 橫式 PDF → A0 橫式海報（大圖輸出用）。
#
# Word 輸出 PDF 時會把圖片壓到約 200dpi，直接放大 4 倍只剩 50dpi，所以先把頁面上的圖
# 換回同名 docx 裡的原圖（流程圖、QR、印章），再整頁向量放大；文字與表格線放大後仍是向量。
# 放大後印章也跟著變 4 倍（加章版公章約 75mm）；B1 圖 A0 的印章是實際尺寸，兩張並排時大小不同。
#
# 用法：python scripts/build-explainer-a0.py <A4 說明表.pdf> <輸出 A0.pdf>
#      （同資料夾要有同名 .docx，即 build-explainer-variants.py 的輸出）
import os
import sys
import tempfile
import zipfile

import fitz

A0_LANDSCAPE = (3370.39, 2383.94)


def main(src, out):
    doc = fitz.open(src)
    page = doc[0]
    media = zipfile.ZipFile(os.path.splitext(src)[0] + '.docx')
    # docx 內的圖依插入順序：image1 流程圖、image2 QR、image3 公章、image4 公告章（加章版才有）
    placed = sorted(((page.get_image_bbox(item), item[0]) for item in page.get_images(full=True)), key=lambda t: t[0].x0)
    seals = iter(['word/media/image3.png', 'word/media/image4.png'])
    with tempfile.TemporaryDirectory() as tmp:
        for bbox, xref in placed:
            if bbox.x0 < 100:
                name = 'word/media/image1.png'  # 左欄流程圖
            elif bbox.x0 > 690:
                name = 'word/media/image2.png'  # 最右 QR
            else:
                name = next(seals)  # 署名兩側的印章，左公章右公告章
            path = os.path.join(tmp, os.path.basename(name))
            with open(path, 'wb') as f:
                f.write(media.read(name))
            page.replace_image(xref, filename=path)
        poster = fitz.open()
        p = poster.new_page(width=A0_LANDSCAPE[0], height=A0_LANDSCAPE[1])
        p.show_pdf_page(p.rect, doc, 0)
        poster.save(out, garbage=3, deflate=True)
    print('wrote', out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('用法：python scripts/build-explainer-a0.py <A4 說明表.pdf> <輸出 A0.pdf>')
    main(sys.argv[1], sys.argv[2])
