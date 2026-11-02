// 重機在維護頁指派時，某格可搭配的相鄰大位（實體相鄰，見 scripts/build-seat-adjacency.mjs）。
import seatAdjacency from './seat-adjacency.json' with { type: 'json' }

// seat：主格；seats：機車主檔；isFree(id)：這格能不能用（沒鎖、沒人佔）。
export function heavyPartners(seat, seats, isFree, adjacency = seatAdjacency.adj) {
  const usable = (s) => s && s.type === '大' && !s.public
  if (!usable(seat)) return []
  const byId = new Map(seats.map((s) => [String(s.id), s]))
  return (adjacency[String(seat.id)] || [])
    .filter((id) => usable(byId.get(String(id))) && isFree(String(id)))
    .map(String)
    .sort((a, b) => +a - +b)
}
