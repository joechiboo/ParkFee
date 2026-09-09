// Big5 編碼／解碼 — 社區幫匯入檔用（docs/24 §1：Big5、無 BOM）。
//
// 為什麼自己做：Node 的 TextDecoder 支援 'big5'，但 TextEncoder **只輸出 UTF-8**，
// 沒有內建 Big5 編碼器。與其為了一支腳本引入 iconv-lite，這裡用解碼器反推編碼表——
// 列舉所有合法的 Big5 雙位元組組合解碼一次，建 char → bytes 的反向表（約 1.4 萬字，
// 建表 <100ms，之後查表 O(1)）。零依賴，且保證與解碼端完全對稱。

const decoder = new TextDecoder('big5')

// 反向表惰性建置：第一次 encodeBig5 時才付建表成本。
let charToBytes = null

function buildTable() {
  const map = new Map()
  // Big5 雙位元組：首位元組 0x81–0xFE，次位元組 0x40–0x7E 或 0xA1–0xFE。
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail > 0x7e && trail < 0xa1) continue // 0x7F–0xA0 非合法次位元組
      const ch = decoder.decode(new Uint8Array([lead, trail]))
      // 解不出來的組合會得到 U+FFFD（替換字元）或多字元 → 跳過。
      if (ch.length !== 1 || ch === '�') continue
      // 同一個字可能有多組編碼（Big5 有重複碼位）→ 保留第一個（碼位較小者），
      // 與多數轉碼工具行為一致，避免產出物業系統不認得的異體碼位。
      if (!map.has(ch)) map.set(ch, [lead, trail])
    }
  }
  return map
}

// UTF-8 字串 → Big5 Buffer。無法編碼的字元以 fallback（預設 '?'）代替，
// 並回報到 onUnmappable，讓呼叫端能決定是否中止（帳務檔不該默默吃掉字元）。
export function encodeBig5(str, { fallback = '?', onUnmappable = null } = {}) {
  if (!charToBytes) charToBytes = buildTable()
  const out = []
  for (const ch of str) {
    const code = ch.codePointAt(0)
    if (code < 0x80) {
      out.push(code) // ASCII 與 Big5 相容
      continue
    }
    const bytes = charToBytes.get(ch)
    if (bytes) {
      out.push(bytes[0], bytes[1])
    } else {
      if (onUnmappable) onUnmappable(ch)
      for (const b of Buffer.from(fallback, 'ascii')) out.push(b)
    }
  }
  return Buffer.from(out)
}

// Big5 Buffer → UTF-8 字串。
export function decodeBig5(buf) {
  return decoder.decode(buf)
}
