// 鎖定車位（物業維護）— 跨頁共用的 reactive 清單。
//   讀：Supabase locked_seat（anon 可讀，非敏感）；無 Supabase 則用本機 localStorage。
//   寫：Edge Function set-locked（驗管理員密碼）；無 Supabase 則只寫本機。
// 選位頁/抽籤頁/維護頁都 import 這支的 lockedSeats（reactive），refreshLocked() 載入。

import { ref } from 'vue'
import { loadOccupied, saveOccupied } from './occupied.js' // 本機快取（離線/抽籤同機用）

const useSupabase = !!import.meta.env?.VITE_SUPABASE_URL

// 初值用本機快取 → 立即可用；refreshLocked() 再覆蓋成雲端最新。
export const lockedSeats = ref(new Set(loadOccupied().map(String)))
export const isLockedId = (id) => lockedSeats.value.has(String(id))

async function client() {
  return (await import('./supabase-client.js')).supabase
}

// 從雲端（或本機）載入鎖定清單 → 更新 lockedSeats + 本機快取。
export async function refreshLocked() {
  if (!useSupabase) {
    lockedSeats.value = new Set(loadOccupied().map(String))
    return
  }
  try {
    const { data, error } = await (await client()).from('locked_seat').select('車位編號')
    if (error) throw error
    const ids = (data || []).map((r) => String(r.車位編號))
    lockedSeats.value = new Set(ids)
    saveOccupied(ids) // 同步本機，供抽籤同機/離線
  } catch {
    /* 讀失敗就維持現值（本機快取） */
  }
}

// 設定鎖定清單（整批取代）。password＝管理員密碼（登入時的車號）。
export async function setLocked(ids, password) {
  const clean = [...new Set((ids || []).map(String))]
  if (useSupabase) {
    const { data, error } = await (await client()).functions.invoke('set-locked', {
      body: { 車位編號: clean, password },
    })
    let msg = error?.message
    try {
      const j = await error?.context?.json?.()
      if (j?.error) msg = j.error
    } catch {
      /* ignore */
    }
    if (error) throw new Error(msg || '儲存失敗，請稍後再試')
    if (data?.error) throw new Error(data.error)
  }
  lockedSeats.value = new Set(clean)
  saveOccupied(clean) // 本機快取
}
