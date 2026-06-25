// PaddleOCR 單例：整個 SPA session 只初始化一次。
//   - 模型自架在 GitHub Pages（public/models/ocr/*）→ 不走百度 CDN（快、可靠）。
//   - 開關相機/換頁面都重用同一個引擎：不重抓、不重編譯。
//   - 只有「整頁重新整理」才會重新初始化（重編譯 WebGL，約幾秒）；但模型檔已被瀏覽器快取，
//     不會重新下載（最多一次 304 驗證）。
// 引擎要換（如改 onnxruntime-web ANPR）只動這支，CamScanner 不必改。

let initPromise = null

// 確保 OCR 已初始化（首次會動態載入 paddlejs runtime + 從自架路徑載模型）。
export function ensureOcr() {
  if (!initPromise) {
    initPromise = (async () => {
      const ocr = await import('@paddlejs-models/ocr')
      const base = import.meta.env.BASE_URL // 正式為 /ParkFee/，dev 為 /
      await ocr.init(base + 'models/ocr/det/model.json', base + 'models/ocr/rec/model.json')
      return ocr
    })().catch((e) => {
      initPromise = null // 失敗就重置，下次可重試
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
