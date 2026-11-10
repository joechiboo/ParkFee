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

// 批次鎖定／解除，只增減指定格（set-locked 2026-11-02 起只認 op＋異動）。管理員驗證由 adminAuth() 提供（密碼 or 車牌擁有權）。
// 回傳 skipped：已掛車而未解除的格。
export async function batchLock(mode, ids) {
  const changes = [...new Set((ids || []).map(String))]
  const changeSet = new Set(changes)
  const cur = [...lockedSeats.value].map(String)
  const next = mode === 'lock' ? [...new Set([...cur, ...changes])] : cur.filter((id) => !changeSet.has(id))
  let skipped = []
  if (useSupabase) {
    const { data, error } = await (await client()).functions.invoke('set-locked', {
      body: { op: mode, 異動: changes, ...adminAuth() },
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
    skipped = data?.skipped || []
  }
  const final = [...next, ...skipped.map(String)]
  lockedSeats.value = new Set(final)
  saveOccupied(final) // 本機快取
  return { skipped }
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

// 指派/鎖定一個車位。rec：{ 車位編號, 車位類型, 車號?, 配位狀態?, 已繳費?, 配對車位? }（重機帶相鄰大位）。
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
  if (rec.配對車位) next.add(String(rec.配對車位))
  lockedSeats.value = next
  saveOccupied([...next])
}

// 解鎖一個車位；帶車號則一併清掉該車指派（重機兩格一起解，以後端回傳的 released 為準）。
// 放棄=true：逾期未繳，該車狀態留「視同放棄」，第二輪不再分配；一般解除（換位、改指派）不帶。
export async function unlockSeat(seatId, plate, { 放棄 = false } = {}) {
  const seat = String(seatId ?? '').trim()
  if (!seat) return
  let released = [seat]
  if (useSupabase) {
    const data = await callAssign({ op: 'unlock', 車位編號: seat, 車號: plate || '', 放棄, ...adminAuth() })
    released = (data?.released || released).map(String)
  }
  const next = new Set(lockedSeats.value)
  for (const id of released) next.delete(id)
  lockedSeats.value = next
  saveOccupied([...next])
}

// 更正戶號（管理員）：住戶把戶號填錯時改成正確的，整戶的車、志願、車位、繳費一起搬。
// 新戶號已有登記時後端會拒絕，不做合併。
export async function renameHousehold(oldId, newId) {
  if (!useSupabase) throw new Error('本機模式不支援更正戶號')
  const { data, error } = await (await client()).functions.invoke('rename-household', {
    body: { 舊戶號: oldId, 新戶號: newId, ...adminAuth() },
  })
  let msg = error?.message
  try {
    const j = await error?.context?.json?.()
    if (j?.error) msg = j.error
  } catch {
    /* ignore */
  }
  if (error) throw new Error(msg || '更正失敗，請稍後再試')
  if (data?.error) throw new Error(data.error)
  return data
}
