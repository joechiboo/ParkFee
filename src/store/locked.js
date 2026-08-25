// 鎖定車位（物業維護）— 跨頁共用的 reactive 清單。
//   讀：Supabase locked_seat（anon 可讀，非敏感）；無 Supabase 則用本機 localStorage。
//   寫：Edge Function set-locked（驗管理員密碼）；無 Supabase 則只寫本機。
// 選位頁/抽籤頁/維護頁都 import 這支的 lockedSeats（reactive），refreshLocked() 載入。

import { ref } from 'vue'
import { loadOccupied, saveOccupied } from './occupied.js' // 本機快取（離線/抽籤同機用）
import { adminAuth } from './session.js' // 管理員驗證 body（密碼 or 車牌擁有權）

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

// 設定鎖定清單（整批取代）。管理員驗證由 adminAuth() 提供（密碼 or 車牌擁有權）。
export async function setLocked(ids) {
  const clean = [...new Set((ids || []).map(String))]
  if (useSupabase) {
    const { data, error } = await (await client()).functions.invoke('set-locked', {
      body: { 車位編號: clean, ...adminAuth() },
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

// 呼叫 assign-seat（驗管理員密碼），把錯誤訊息攤平。
async function callAssign(body) {
  const { data, error } = await (await client()).functions.invoke('assign-seat', { body })
  let msg = error?.message
  let payload = null
  try {
    payload = await error?.context?.json?.()
    if (payload?.error) msg = payload.error
  } catch {
    /* ignore */
  }
  if (error) {
    const e = new Error(msg || '操作失敗，請稍後再試')
    if (payload?.needsConfirm) e.needsConfirm = true // 公益位資格不符 → 前端跳確認
    throw e
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// 管理員專屬：讀回目前鎖定清單 + 各位指派（戶號/車號/繳費，來自 deny-all 的 vehicle）。
// 無 Supabase 時退回「只有 id」（本機無 vehicle 個資）。
export async function listAssignments() {
  if (!useSupabase) return [...lockedSeats.value].map((id) => ({ 車位編號: id }))
  const data = await callAssign({ op: 'list', ...adminAuth() })
  return data?.assignments || []
}

// 指派/鎖定一個車位。rec：{ 車位編號, 車位類型, 車號?, 配位狀態?, 已繳費? }。
// 帶車號 → 把該車指派到此位（寫 vehicle）；不帶 → 純鎖定（保留/維修）。
// 公益位資格不符時後端回 409 + needsConfirm；前端確認後再帶 強制:true 呼叫一次。
export class AssignNeedsConfirm extends Error {}

export async function assignSeat(rec) {
  const seat = String(rec?.車位編號 ?? '').trim()
  if (!seat) throw new Error('缺少車位編號')
  if (useSupabase) {
    try {
      await callAssign({ op: 'assign', ...rec, 車位編號: seat, ...adminAuth() })
    } catch (e) {
      const msg = e?.message || ''
      // supabase-js 把非 2xx 包成 FunctionsHttpError，訊息裡帶回應內容
      if (e?.needsConfirm) throw new AssignNeedsConfirm(msg)
      throw e
    }
  }
  const next = new Set(lockedSeats.value)
  next.add(seat)
  lockedSeats.value = next
  saveOccupied([...next])
}

// 解鎖一個車位；帶車號則一併清掉該車指派。
export async function unlockSeat(seatId, plate) {
  const seat = String(seatId ?? '').trim()
  if (!seat) return
  if (useSupabase) {
    await callAssign({ op: 'unlock', 車位編號: seat, 車號: plate || '', ...adminAuth() })
  }
  const next = new Set(lockedSeats.value)
  next.delete(seat)
  lockedSeats.value = next
  saveOccupied([...next])
}
