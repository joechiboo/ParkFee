// 抽籤名冊（共用）：dev 專區匯入真實名冊 CSV（全戶個資）→ 存這裡 → /allocate 抽籤頁讀取。
// 只在使用者自己的瀏覽器 session（module-level ref）：不持久化、不上傳、不外流；
// 未匯入時 /allocate 用內建範例 demo（鄰居可試跑看演算法）。
import { ref } from 'vue'

export const importedRoster = ref(null) // buildRoster 的 entries 陣列，或 null＝用範例
export const importInfo = ref('') // 匯入摘要文字（檔名 · 戶/輛/輪）

export function setImportedRoster(entries, info) {
  importedRoster.value = entries
  importInfo.value = info || ''
}
export function clearImportedRoster() {
  importedRoster.value = null
  importInfo.value = ''
}
