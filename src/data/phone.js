// 台灣電話格式化（登記表單顯示用）。
// 手機：09 開頭 10 碼 → 09XX-XXX-XXX（4-3-3）。
// 市話／不完整：僅去除非數字，不強制斷字（區碼長度不一，2/3 碼皆有，硬斷易錯）。
export function formatTWPhone(raw) {
  const d = String(raw ?? '').replace(/\D/g, '') // 只留數字
  if (/^09\d{8}$/.test(d)) return d.replace(/(\d{4})(\d{3})(\d{3})/, '$1-$2-$3')
  return d
}
