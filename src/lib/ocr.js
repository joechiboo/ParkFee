import { ref } from 'vue'

// PaddleOCR 單例：整個 SPA session 只初始化一次。
//   - 模型自架在 GitHub Pages（public/models/ocr/*）→ 不走百度 CDN（快、可靠）。
//   - 開關相機/換頁面都重用同一個引擎：不重抓、不重編譯。
//   - 只有「整頁重新整理」才會重新初始化（重編譯 WebGL，約幾秒）；但模型檔已被瀏覽器快取，
//     不會重新下載（最多一次 304 驗證）。
// 引擎要換（如改 onnxruntime-web ANPR）只動這支，CamScanner 不必改。

// 載入進度（給 UI 顯示）。stage：''｜載入引擎｜下載模型｜初始化；progress：下載階段 0..100。
export const ocrStage = ref('')
export const ocrProgress = ref(0)

// 自架模型檔（size 用於算下載進度百分比）。
const FILES = [
  { path: 'models/ocr/det/model.json', size: 288358 },
  { path: 'models/ocr/det/chunk_1.dat', size: 2289764 },
  { path: 'models/ocr/rec/model.json', size: 1028975 },
  { path: 'models/ocr/rec/chunk_1.dat', size: 4194304 },
  { path: 'models/ocr/rec/chunk_2.dat', size: 4115204 },
]
const TOTAL = FILES.reduce((s, f) => s + f.size, 0)

// 自行串流下載模型檔（顯示進度）→ 進瀏覽器快取 → 之後 ocr.init 直接讀快取（不重抓）。
async function prefetchModels(base) {
  let loaded = 0
  for (const f of FILES) {
    try {
      const res = await fetch(base + f.path)
      const reader = res.body?.getReader?.()
      if (!reader) {
        loaded += f.size
      } else {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          loaded += value.length
          ocrProgress.value = Math.min(99, Math.round((loaded / TOTAL) * 100))
        }
      }
    } catch {
      loaded += f.size // 單檔失敗略過，交給 init 再試
    }
    ocrProgress.value = Math.min(99, Math.round((loaded / TOTAL) * 100))
  }
}

let initPromise = null

// 確保 OCR 已初始化（singleton）。階段：載入引擎 → 下載模型(有進度) → 初始化。
export function ensureOcr() {
  if (!initPromise) {
    initPromise = (async () => {
      const base = import.meta.env.BASE_URL // 正式 /ParkFee/，dev /
      ocrStage.value = '載入引擎'
      ocrProgress.value = 0
      const ocr = await import('@paddlejs-models/ocr')
      ocrStage.value = '下載模型'
      await prefetchModels(base)
      ocrStage.value = '初始化'
      await ocr.init(base + 'models/ocr/det/model.json', base + 'models/ocr/rec/model.json')
      ocrProgress.value = 100
      ocrStage.value = ''
      return ocr
    })().catch((e) => {
      initPromise = null // 失敗就重置，下次可重試
      ocrStage.value = ''
      throw e
    })
  }
  return initPromise
}

// 對 canvas 做偵測+辨識 → 回傳偵測到的文字字串陣列（可能多段）。
export async function ocrRecognizeTexts(canvas) {
  const ocr = await ensureOcr()
  const res = await ocr.recognize(canvas)
  return Array.isArray(res?.text) ? res.text : res?.text ? [res.text] : []
}
