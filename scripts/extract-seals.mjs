// 從管委會公告 PDF 剪下兩顆印章（紅色方章「樂菲莊園管理委員會」、藍色橢圓「公告章」），去背存 PNG。
//
// ⚠️ 輸出一律在 private/seals/（不進版控）。本 repo 為**公開**——高解析度的管委會印章
//    若進版控或放上網站，任何人都能下載拿去偽造公告。程式碼本身不含印章、可公開。
//
// 用法：node scripts/extract-seals.mjs <公告.pdf> [--debug]
//   例：node scripts/extract-seals.mjs private/notices/公告_115100101_關閉社區報修.pdf
//   社區公告原檔（含印章）統一放 private/notices/，檔名＝「公告_<文號>_<主旨>.pdf」。
//   公告版面固定（2026-10 兩份公告比對一致）：頁尾左側紅章、右側藍色公告章。
//   座標以「頁寬／頁高」比例描述，掃描稍有偏移也框得到；框內再自動修邊到墨跡範圍。
import * as mupdf from 'mupdf'
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const src = process.argv[2]
if (!src) throw new Error('用法：node scripts/extract-seals.mjs <公告.pdf>')
const DEBUG = process.argv.includes('--debug')
const SCALE = 6 // 約 430 dpi：A3 圖上印章約 3cm，足夠印刷

const doc = mupdf.Document.openDocument(readFileSync(src), 'application/pdf')
// toPixmap 會套用頁面旋轉（公告是旋轉 90° 的直式掃描），座標即「看到的那張」
const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false)
const full = PNG.sync.read(Buffer.from(pix.asPNG()))
const W = full.width, H = full.height

// 頁尾兩顆章的大致範圍（比例；取自 1.5× 預覽：紅章 x125–242/893、藍章 x648–848，y 約 1082–1218/1263）
const SEALS = {
  'seal-committee': { name: '紅色方章（管理委員會）', x0: 0.11, x1: 0.30, y0: 0.84, y1: 0.98 },
  'seal-notice': { name: '藍色公告章', x0: 0.70, x1: 0.97, y0: 0.83, y1: 0.98 },
}

// 「墨跡度」：紙是近白（三色皆高），印泥是紅或藍（至少一色明顯偏低）→ 以最小色值判斷，
// 轉成平滑的 alpha，邊緣不會鋸齒。
const inkAlpha = (r, g, b) => {
  const m = Math.min(r, g, b)
  return Math.max(0, Math.min(255, Math.round(((232 - m) * 255) / 112)))
}

mkdirSync('private/seals', { recursive: true })
for (const [key, s] of Object.entries(SEALS)) {
  const bx0 = Math.round(s.x0 * W), bx1 = Math.round(s.x1 * W)
  const by0 = Math.round(s.y0 * H), by1 = Math.round(s.y1 * H)

  // 框內墨跡遮罩 → 連通區塊標記。掃描檔常有灰塵小點（2026-10 公告章左側就有一顆），
  // 直接取墨跡外框會被灰塵撐大；印章筆畫都是成片相連，故濾掉面積過小的區塊再修邊。
  const bw = bx1 - bx0, bh = by1 - by0
  const ink = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = ((by0 + y) * W + (bx0 + x)) * 4
      ink[y * bw + x] = inkAlpha(full.data[i], full.data[i + 1], full.data[i + 2]) > 140 ? 1 : 0
    }
  const label = new Int32Array(bw * bh)
  const areas = [0]
  const stack = []
  for (let p = 0; p < ink.length; p++) {
    if (!ink[p] || label[p]) continue
    const id = areas.length
    let area = 0
    stack.push(p)
    label[p] = id
    while (stack.length) {
      const q = stack.pop()
      area++
      const qx = q % bw, qy = (q - qx) / bw
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue
          const n = ny * bw + nx
          if (ink[n] && !label[n]) { label[n] = id; stack.push(n) }
        }
    }
    areas.push(area)
  }
  const MIN_AREA = 400 // 6× 下約 1mm²；筆畫遠大於此、灰塵遠小於此
  const keep = (p) => label[p] && areas[label[p]] >= MIN_AREA
  let mx0 = bx1, my0 = by1, mx1 = bx0, my1 = by0
  for (let p = 0; p < ink.length; p++) {
    if (!keep(p)) continue
    const x = bx0 + (p % bw), y = by0 + Math.floor(p / bw)
    if (x < mx0) mx0 = x
    if (x > mx1) mx1 = x
    if (y < my0) my0 = y
    if (y > my1) my1 = y
  }
  if (mx1 <= mx0) throw new Error(`${s.name}：框內找不到墨跡，公告版面可能不同`)
  const dropped = areas.filter((a, i) => i && a < MIN_AREA).length
  // 輸出時也一併把灰塵設為透明（框內灰塵若落在印章外框內側角落仍會被帶進來）
  const isDust = (x, y) => {
    const lx = x - bx0, ly = y - by0
    if (lx < 0 || ly < 0 || lx >= bw || ly >= bh) return false
    const p = ly * bw + lx
    return label[p] && areas[label[p]] < MIN_AREA
  }
  const pad = 8
  mx0 = Math.max(0, mx0 - pad); my0 = Math.max(0, my0 - pad)
  mx1 = Math.min(W - 1, mx1 + pad); my1 = Math.min(H - 1, my1 + pad)

  const w = mx1 - mx0 + 1, h = my1 - my0 + 1
  const out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = ((my0 + y) * W + (mx0 + x)) * 4
      const di = (y * w + x) * 4
      const r = full.data[si], g = full.data[si + 1], b = full.data[si + 2]
      out.data[di] = r
      out.data[di + 1] = g
      out.data[di + 2] = b
      out.data[di + 3] = DEBUG ? 255 : isDust(mx0 + x, my0 + y) ? 0 : inkAlpha(r, g, b)
    }
  const file = `private/seals/${key}.png`
  writeFileSync(file, PNG.sync.write(out))
  console.log(`✓ ${file}  ${w}×${h}px  （${s.name}；濾掉灰塵 ${dropped} 點）`)
}
