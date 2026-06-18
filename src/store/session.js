import { ref, watch } from 'vue'

// 登入後的整戶資料 + 登入用車號（編輯/存志願時當擁有權證明），跨頁面導覽保留。
// 持久化到 **sessionStorage**：重新整理仍保持登入；關閉分頁/瀏覽器自動清除（身分不長期落地）。
// 登入只用「戶號＋車號」（非機密），故存於 sessionStorage 可接受；DB 仍由 RLS + Edge Function 保護。

const HKEY = 'parkfee:session:household'
const PKEY = 'parkfee:session:plate'

const safeGet = (k) => {
  try {
    return sessionStorage.getItem(k)
  } catch {
    return null
  }
}
const safeSet = (k, v) => {
  try {
    if (v == null || v === '') sessionStorage.removeItem(k)
    else sessionStorage.setItem(k, v)
  } catch {
    /* ignore（無痕模式等） */
  }
}

function loadHousehold() {
  try {
    return JSON.parse(safeGet(HKEY) || 'null')
  } catch {
    return null
  }
}

export const sessionHousehold = ref(loadHousehold())
export const sessionPlate = ref(safeGet(PKEY) || '')

watch(sessionHousehold, (v) => safeSet(HKEY, v ? JSON.stringify(v) : null), { deep: true })
watch(sessionPlate, (v) => safeSet(PKEY, v || null))

export function clearSession() {
  sessionHousehold.value = null
  sessionPlate.value = ''
  safeSet(HKEY, null)
  safeSet(PKEY, null)
}
