// 車牌辨識（RoboEye 路線：onnxruntime-web）。
//   - ort 從 jsdelivr CDN 載入（全域 window.ort，繞過 Vite 打包；RoboEye 同法）。
//   - 模型自架在 GitHub Pages（public/models/rec/）：en_PP-OCRv3_rec（英數，9MB）+ en_dict.txt。
//   - 辨識-only：對框內裁切的車牌做 CTC 文字辨識（純前端、不上傳、$0）。
//   - singleton：一個 session 重用；下載有進度。引擎要換只動這支。
import { ref } from 'vue'

export const ocrStage = ref('') // '載入引擎' | '下載模型' | '初始化' | ''
export const ocrProgress = ref(0) // 下載模型 0..100

const ORT_VER = '1.21.0'
const ORT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/ort.min.js`
const ORT_WASM = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`
const MODEL_SIZE = 8967018 // en_rec.onnx 位元組（算下載百分比）

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

async function fetchModelWithProgress(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('模型下載失敗 ' + res.status)
  const reader = res.body.getReader()
  const chunks = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    ocrProgress.value = Math.min(99, Math.round((loaded / MODEL_SIZE) * 100))
  }
  const buf = new Uint8Array(loaded)
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
      const ort = await loadOrt()
      ort.env.wasm.wasmPaths = ORT_WASM
      ocrStage.value = '下載模型'
      const modelBuf = await fetchModelWithProgress(base + 'models/rec/en_rec.onnx')
      const dictTxt = await (await fetch(base + 'models/rec/en_dict.txt')).text()
      const dict = dictTxt.replace(/\r/g, '').split('\n')
      if (dict[dict.length - 1] === '') dict.pop()
      ocrStage.value = '初始化'
      const session = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'] })
      ocrProgress.value = 100
      ocrStage.value = ''
      return { ort, session, dict }
    })().catch((e) => {
      initPromise = null
      ocrStage.value = ''
      throw e
    })
  }
  return initPromise
}

// 對「已裁切成車牌的 canvas」做辨識 → 回傳原始辨識字串。
// PP-OCR rec 前處理：高 48、保比例縮寬、BGR、正規化 (v/255-0.5)/0.5；輸出 CTC 貪婪解碼。
export async function ocrRecognize(canvas) {
  const { ort, session, dict } = await ensureOcr()
  const H = 48
  const cw = canvas.width
  const chh = canvas.height
  let W = Math.round((H * cw) / chh)
  W = Math.max(16, Math.min(W, 480))
  const tmp = document.createElement('canvas')
  tmp.width = W
  tmp.height = H
  const tctx = tmp.getContext('2d', { willReadFrequently: true })
  tctx.drawImage(canvas, 0, 0, cw, chh, 0, 0, W, H)
  const px = tctx.getImageData(0, 0, W, H).data
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
  feeds[session.inputNames[0]] = tensor
  const out = await session.run(feeds)
  const o = out[session.outputNames[0]]
  const T = o.dims[1]
  const C = o.dims[2]
  const d = o.data
  let prev = -1
  let text = ''
  for (let t = 0; t < T; t++) {
    let best = 0
    let bv = -Infinity
    const b = t * C
    for (let c = 0; c < C; c++) {
      const v = d[b + c]
      if (v > bv) {
        bv = v
        best = c
      }
    }
    if (best !== 0 && best !== prev) {
      const ci = best - 1 // index 0 = CTC blank；其餘對應 dict（超出＝空白字元）
      text += ci < dict.length ? dict[ci] : ' '
    }
    prev = best
  }
  return text
}
