// 在 b1.png 上標出 AB/CD/EF/GH 四個梯廳核心，並把機車位依「最近核心」分區上色。
// 用於「靠棟別選位」雛形 — 輸出 scripts/_towers.png 供視覺確認。
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const cls = JSON.parse(readFileSync('src/map/b1-classification.json', 'utf8'))
const motor = cls.seats.filter((s) => s.cat === 'motor')
const png = PNG.sync.read(readFileSync('public/demo/b1.png'))
const RATIO = png.width / cls.meta.dispW // b1.png 是顯示座標的 2 倍

// 四個棟別梯廳核心（顯示座標）
const CORES = [
  { name: 'AB', x: 581, y: 424, color: [220, 38, 38] },   // 紅
  { name: 'CD', x: 563, y: 1168, color: [37, 99, 235] },  // 藍
  { name: 'EF', x: 1102, y: 1375, color: [22, 163, 74] }, // 綠
  { name: 'GH', x: 1378, y: 1375, color: [234, 88, 12] }, // 橘
]

function nearest(s) {
  let best = CORES[0], bd = Infinity
  for (const c of CORES) {
    const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2
    if (d < bd) { bd = d; best = c }
  }
  return best
}

const W = png.width, H = png.height, data = png.data
function px(x, y, [r, g, b], a = 1) {
  x = Math.round(x * RATIO); y = Math.round(y * RATIO)
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (W * y + x) << 2
  data[i] = r * a + data[i] * (1 - a); data[i + 1] = g * a + data[i + 1] * (1 - a); data[i + 2] = b * a + data[i + 2] * (1 - a); data[i + 3] = 255
}
function disc(cx, cy, rad, color, a) {
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) px(cx + dx / RATIO, cy + dy / RATIO, color, a)
}

// 機車位 → 依最近核心上色
const counts = {}
for (const s of motor) {
  const c = nearest(s)
  counts[c.name] = (counts[c.name] || 0) + 1
  disc(s.x, s.y, 7, c.color, 0.8)
}

// 核心：大圈 + 黑框十字
for (const c of CORES) {
  disc(c.x, c.y, 26, [0, 0, 0], 1)
  disc(c.x, c.y, 22, c.color, 1)
  disc(c.x, c.y, 9, [255, 255, 255], 1)
}

writeFileSync('scripts/_towers.png', PNG.sync.write(png))
console.log('依最近棟別核心分區：', JSON.stringify(counts), '合計', motor.length)
