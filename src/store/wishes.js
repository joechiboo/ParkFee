// 車位志願序暫存（localStorage，依戶號）。
// 第一版本地暫存，供住戶在選位頁排序、跨重整保留；
// TODO：後端同步（Supabase Edge Function 寫 household.車位志願；schema 見 HANDOFF §8）。
//
// 註：參數一律 ASCII（Vite/esbuild 不吃中文綁定識別字）。

const KEY = (id) => `parkfee:wishes:${id || 'anon'}`

export function loadWishes(id) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(id)) || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function saveWishes(id, list) {
  localStorage.setItem(KEY(id), JSON.stringify(list.map(String)))
}
