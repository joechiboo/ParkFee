// 可重現亂數 — 抽籤須可公開稽核：同 seed → 同序列。
// mulberry32：32-bit 種子的快速 PRNG，足夠抽籤用且結果穩定。

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 把好記的字串種子（例：「2026樂菲莊園機車抽籤」）正規化為 32-bit 整數，
// 讓委員會當眾公告的種子可以是有意義的字串。數字則直接取整。
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0
  const str = String(seed)
  let h = 2166136261 >>> 0 // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Fisher–Yates 洗牌，使用給定的 rng()。回傳新陣列，不改動原陣列。
export function seededShuffle(arr, rng) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]
    a[i] = a[j]
    a[j] = tmp
  }
  return a
}
