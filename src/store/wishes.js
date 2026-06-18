// 車位志願序暫存（localStorage，依戶號）。
// 第一版本地暫存，供住戶在選位頁排序、跨重整保留；
// TODO：後端同步（Supabase Edge Function 寫 household.車位志願；schema 見 HANDOFF §8）。

const KEY = (戶號) => `parkfee:wishes:${戶號 || 'anon'}`

export function loadWishes(戶號) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(戶號)) || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function saveWishes(戶號, wishes) {
  localStorage.setItem(KEY(戶號), JSON.stringify(wishes.map(String)))
}
