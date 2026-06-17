import { ref } from 'vue'

// 登入後的整戶資料 + 登入用車號（編輯時當擁有權證明），跨頁面導覽保留。
// 純記憶體狀態：重新整理頁面會清空，需重新登入（不落地敏感資料）。
export const sessionHousehold = ref(null)
export const sessionPlate = ref('')

export function clearSession() {
  sessionHousehold.value = null
  sessionPlate.value = ''
}
