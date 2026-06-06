// 極簡 CSV 解析／輸出，純前端、零相依。
// 支援：引號包欄、欄內逗號／換行、跳脫雙引號（""）、去 BOM、\r\n 與 \n。

export function parseCSV(text) {
  if (text == null) return []
  let s = String(text)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1) // 去 UTF-8 BOM
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      // 忽略，等 \n 收列（處理 \r\n）
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// 解析成物件陣列（第一列為表頭）。空白列略過。
export function parseCSVObjects(text) {
  const rows = parseCSV(text).filter((r) => !(r.length === 1 && r[0].trim() === ''))
  if (rows.length === 0) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
}

// 物件陣列 → CSV 字串（依給定欄位順序）。含逗號／引號／換行的值自動加引號跳脫。
export function toCSV(objs, columns) {
  const esc = (v) => {
    const str = v == null ? '' : String(v)
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  const lines = [columns.join(',')]
  for (const o of objs) lines.push(columns.map((c) => esc(o[c])).join(','))
  return lines.join('\r\n')
}
