// 在 b1.png 上畫出分類點 + 座標格線，輸出 classified.png 供視覺檢查。
// 分類由 ZONES（矩形規則）決定，未落在任何 zone 的點 → 預設機車。
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const seats = JSON.parse(readFileSync('public/demo/seats.json', 'utf8'))
const png = PNG.sync.read(readFileSync('public/demo/b1.png'))
const { width: W, height: H, data } = png

// 分類矩形：{cat, x1,y1,x2,y2}。點落在矩形內 → 該 cat。後面的覆蓋前面的。
// cat: excl(排除) / car(汽車) / bike(腳踏車) / motor(機車，預設)
const ZONES = JSON.parse(process.env.ZONES || '[]')

function classify(s) {
  let cat = 'motor'
  for (const z of ZONES) if (s.x >= z.x1 && s.x <= z.x2 && s.y >= z.y1 && s.y <= z.y2) cat = z.cat
  return cat
}

const COLOR = {
  motor: [37, 99, 235],
  car: [16, 185, 129],
  bike: [249, 115, 22],
  excl: [148, 163, 184],
}

function px(x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (W * Math.round(y) + Math.round(x)) << 2
  data[i] = r * a + data[i] * (1 - a)
  data[i + 1] = g * a + data[i + 1] * (1 - a)
  data[i + 2] = b * a + data[i + 2] * (1 - a)
  data[i + 3] = 255
}
function disc(cx, cy, rad, color, a) {
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++)
      if (dx * dx + dy * dy <= rad * rad) px(cx + dx, cy + dy, color, a)
}

// 座標格線（每 200px 淡灰，每 500px 較深）
for (let gx = 0; gx < W; gx += 100) {
  const strong = gx % 500 === 0
  for (let y = 0; y < H; y++) px(gx, y, strong ? [220, 40, 40] : [120, 160, 230], strong ? 0.5 : 0.25)
}
for (let gy = 0; gy < H; gy += 100) {
  const strong = gy % 500 === 0
  for (let x = 0; x < W; x++) px(x, gy, strong ? [220, 40, 40] : [120, 160, 230], strong ? 0.5 : 0.25)
}

const counts = { motor: 0, car: 0, bike: 0, excl: 0 }
for (const s of seats) {
  const cat = classify(s)
  counts[cat]++
  disc(s.x, s.y, 8, COLOR[cat], 0.85)
}

writeFileSync('scripts/_classified.png', PNG.sync.write(png))
console.log('counts:', counts, 'total', seats.length)
console.log('紅線=每500px，藍線=每100px。zones:', ZONES.length)
