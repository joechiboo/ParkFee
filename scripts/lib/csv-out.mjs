// CSV 寫檔 — 一律加 UTF-8 BOM。
//
// 為什麼非加不可：這些 CSV 是要交給物業用 Excel 開的。繁中 Windows 的 Excel
// 對沒有 BOM 的 .csv 會用系統 ANSI（CP950/Big5）去解，UTF-8 的中文就變亂碼
// （「戶號」變「?嗎?」那種）。加了 BOM，Excel 才認得出是 UTF-8。
//
// 讀回來不受影響：parseCSV()（src/data/csv.js）開頭就會去掉 BOM。
//
// 用跳脫碼 \uFEFF 而非直接在原始碼放那個看不見的字元——看不見的字元容易被
// 編輯器、linter 或複製貼上吃掉，壞掉時還很難看出來。
import { writeFileSync } from 'node:fs'

export const BOM = '\uFEFF'

// 寫出 UTF-8 CSV（自動補 BOM；已有 BOM 則不重複加）。
export function writeCsvUtf8(path, csv) {
  const body = csv.startsWith(BOM) ? csv : BOM + csv
  writeFileSync(path, body, 'utf8')
  return body.length
}
