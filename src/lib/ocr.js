// 車牌辨識（RoboEye 路線：onnxruntime-web）。先「偵測」文字行 → 再各行「辨識」→ 挑出車牌格式那行。
//   - ort 從 jsdelivr CDN 載入（全域 window.ort，繞過 Vite 打包）。
//   - 模型自架 GitHub Pages：det = ch_PP-OCRv3_det(2.4MB 文字偵測) + rec = en_PP-OCRv3_rec(9MB 英數)。
//   - 偵測解決「兩行車牌 / 雜訊」：把「電動車」與「號碼」分成不同行 → 辨識號碼那行、其餘丟掉。
//   - 純前端、不上傳、$0。singleton + 下載進度。
import { ref } from 'vue'

export const ocrStage = ref('') // '載入引擎' | '下載模型' | '初始化' | ''
export const ocrProgress = ref(0)

const ORT_VER = '1.21.0'
const ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.min.js`
const ORT_WASM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`
const DET_SIZE = 2432880
const REC_SIZE = 8967018
const TOTAL = DET_SIZE + REC_SIZE
const DET_MAXSIDE = 480 // 偵測輸入最長邊（小→快，對手機友善）

function loadOrt() {
  if (window.ort) return Promise.resolve(window.ort)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = ORT_URL
    s.onload = () => resolve(window.ort)
    s.onerror = () => reject(new Error('onnxruntime-web 載入失敗（CDN）'))
    document.head.appendChild(s)
  })
}

let loadedBytes = 0
async function fetchBuf(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('模型下載失敗 ' + res.status)
  const reader = res.body.getReader()
  const chunks = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loadedBytes += value.length
    ocrProgress.value = Math.min(99, Math.round((loadedBytes / TOTAL) * 100))
  }
  let len = 0
  for (const c of chunks) len += c.length
  const buf = new Uint8Array(len)
  let pos = 0
  for (const c of chunks) {
    buf.set(c, pos)
    pos += c.length
  }
  return buf
}

let initPromise = null
export function ensureOcr() {
  if (!initPromise) {
    initPromise = (async () => {
      const base = import.meta.env.BASE_URL
      ocrStage.value = '載入引擎'
      ocrProgress.value = 0
      loadedBytes = 0
      const ort = await loadOrt()
      ort.env.wasm.wasmPaths = ORT_WASM
      ocrStage.value = '下載模型'
      const detBuf = await fetchBuf(base + 'models/det/det.onnx')
      const recBuf = await fetchBuf(base + 'models/rec/en_rec.onnx')
      const dictTxt = await (await fetch(base + 'models/rec/en_dict.txt')).text()
      const dict = dictTxt.replace(/\r/g, '').split('\n')
      if (dict[dict.length - 1] === '') dict.pop()
      ocrStage.value = '初始化'
      const det = await ort.InferenceSession.create(detBuf, { executionProviders: ['wasm'] })
      const rec = await ort.InferenceSession.create(recBuf, { executionProviders: ['wasm'] })
      ocrProgress.value = 100
      ocrStage.value = ''
      return { ort, det, rec, dict }
    })().catch((e) => {
      initPromise = null
      ocrStage.value = ''
      throw e
    })
  }
  return initPromise
}

// ── 偵測：回傳文字行的方框（原 canvas 座標）。用列投影找橫向文字帶 → 穩定分行（含兩行車牌）。
async function detect(canvas, det, ort) {
  const cw = canvas.width
  const chh = canvas.height
  const scale = Math.min(DET_MAXSIDE / cw, DET_MAXSIDE / chh, 1)
  const r32 = (n) => Math.max(32, Math.round((n * scale) / 32) * 32)
  const rw = r32(cw)
  const rh = r32(chh)
  const tmp = document.createElement('canvas')
  tmp.width = rw
  tmp.height = rh
  const tctx = tmp.getContext('2d', { willReadFrequently: true })
  tctx.drawImage(canvas, 0, 0, cw, chh, 0, 0, rw, rh)
  const px = tctx.getImageData(0, 0, rw, rh).data
  const arr = new Float32Array(3 * rw * rh)
  const plane = rw * rh
  const m = [0.485, 0.456, 0.406]
  const s = [0.229, 0.224, 0.225]
  for (let i = 0; i < plane; i++) {
    const o = i * 4
    arr[i] = (px[o] / 255 - m[0]) / s[0]
    arr[plane + i] = (px[o + 1] / 255 - m[1]) / s[1]
    arr[2 * plane + i] = (px[o + 2] / 255 - m[2]) / s[2]
  }
  const t = new ort.Tensor('float32', arr, [1, 3, rh, rw])
  const feeds = {}
  feeds[det.inputNames[0]] = t
  const out = await det.run(feeds)
  const o = out[det.outputNames[0]]
  const H = o.dims[2]
  const W = o.dims[3]
  const d = o.data
  // 二值化（機率 > 0.3）
  const bin = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) bin[i] = d[i] > 0.3 ? 1 : 0
  // 列投影找橫向文字帶（每行文字 → 一個帶）
  const minRow = Math.max(2, W * 0.04)
  const bands = []
  let startY = -1
  for (let y = 0; y <= H; y++) {
    let c = 0
    if (y < H) {
      const b = y * W
      for (let x = 0; x < W; x++) c += bin[b + x]
    }
    const has = y < H && c >= minRow
    if (has && startY < 0) startY = y
    else if (!has && startY >= 0) {
      bands.push([startY, y - 1])
      startY = -1
    }
  }
  const boxes = []
  for (const [y0, y1] of bands) {
    if (y1 - y0 < 4) continue
    let minx = W
    let maxx = 0
    for (let y = y0; y <= y1; y++) {
      const b = y * W
      for (let x = 0; x < W; x++) if (bin[b + x]) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
      }
    }
    if (maxx - minx < 8) continue
    boxes.push({
      x: (minx * cw) / W,
      y: (y0 * chh) / H,
      w: ((maxx - minx + 1) * cw) / W,
      h: ((y1 - y0 + 1) * chh) / H,
    })
  }
  return boxes
}

// ── 辨識：對單行裁切做 CTC 文字辨識。
function recognizeCrop(canvas, rec, dict, ort) {
  const H = 48
  const cw = canvas.width
  const chh = canvas.height
  let W = Math.round((H * cw) / chh)
  W = Math.max(16, Math.min(W, 800))
  const tmp = document.createElement('canvas')
  tmp.width = W
  tmp.height = H
  tmp.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, cw, chh, 0, 0, W, H)
  const px = tmp.getContext('2d').getImageData(0, 0, W, H).data
  const arr = new Float32Array(3 * H * W)
  const plane = H * W
  for (let i = 0; i < plane; i++) {
    const o = i * 4
    arr[i] = (px[o + 2] / 255 - 0.5) / 0.5 // B
    arr[plane + i] = (px[o + 1] / 255 - 0.5) / 0.5 // G
    arr[2 * plane + i] = (px[o] / 255 - 0.5) / 0.5 // R
  }
  const tensor = new ort.Tensor('float32', arr, [1, 3, H, W])
  const feeds = {}
  feeds[rec.inputNames[0]] = tensor
  return rec.run(feeds).then((out) => {
    const o = out[rec.outputNames[0]]
    const T = o.dims[1]
    const C = o.dims[2]
    const dd = o.data
    let prev = -1
    let text = ''
    for (let ti = 0; ti < T; ti++) {
      let best = 0
      let bv = -Infinity
      const b = ti * C
      for (let c = 0; c < C; c++) {
        const v = dd[b + c]
        if (v > bv) {
          bv = v
          best = c
        }
      }
      if (best !== 0 && best !== prev) {
        const ci = best - 1
        text += ci < dict.length ? dict[ci] : ' '
      }
      prev = best
    }
    return text
  })
}

// 偵測 + 辨識：回傳所有偵測到的文字行字串（呼叫端自行挑車牌格式那行）。
export async function ocrRecognizePlate(canvas) {
  const { ort, det, rec, dict } = await ensureOcr()
  const boxes = await detect(canvas, det, ort)
  const texts = []
  for (const bx of boxes) {
    const padx = bx.w * 0.06
    const pady = bx.h * 0.3 // DBNet 框偏緊 → 上下多留邊，避免切到字
    const x = Math.max(0, bx.x - padx)
    const y = Math.max(0, bx.y - pady)
    const w = Math.min(canvas.width - x, bx.w + 2 * padx)
    const h = Math.min(canvas.height - y, bx.h + 2 * pady)
    if (w < 8 || h < 6) continue
    const crop = document.createElement('canvas')
    crop.width = Math.round(w)
    crop.height = Math.round(h)
    crop.getContext('2d', { willReadFrequently: true }).drawImage(canvas, x, y, w, h, 0, 0, crop.width, crop.height)
    texts.push(await recognizeCrop(crop, rec, dict, ort))
  }
  return texts
}
