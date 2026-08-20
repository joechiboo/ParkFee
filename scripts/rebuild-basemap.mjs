// 產生 public/demo/b1.png 底圖（由竣工圖渲染並去除粉紅浮水印）。
// 實作在 scripts/lib/basemap.mjs —— seat-demo.mjs / build-classifier.mjs 也走同一支。
// 用法: node scripts/rebuild-basemap.mjs
import { renderBaseMap, BASE_PDF } from './lib/basemap.mjs'

const OUT = 'public/demo/b1.png'
const { width, height } = renderBaseMap(OUT)
console.log(`已寫入 ${OUT}  ${width}x${height}  來源 ${BASE_PDF}（已濾掉浮水印與建照色塊）`)
