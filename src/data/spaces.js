// 車位主檔 — 唯一事實來源：社區地下室停車場管理辦法 §肆（四）（五）（六），115/03/21 修訂
//   一般（大）320 個（公益 8）
//   一般（小）327 個（公益 12）
//   無障礙     8 個
//   合計 647 + 8 = 655

export const SPACE_TYPE = {
  LARGE: '大',
  SMALL: '小',
  ACCESSIBLE: '無障礙',
}

export const GENERAL_LARGE_TOTAL = 320
export const GENERAL_SMALL_TOTAL = 327
export const ACCESSIBLE_TOTAL = 8
export const TOTAL = GENERAL_LARGE_TOTAL + GENERAL_SMALL_TOTAL + ACCESSIBLE_TOTAL // 655

// 公益設施機車位編號（各類型內的編號，編號彼此獨立）。
// 預設：標記為公益、暫不納入個人承租抽籤池（HANDOFF §11-1）。
export const PUBLIC_LARGE = [2, 3, 6, 7, 97, 98, 103, 104]
export const PUBLIC_SMALL = [1, 4, 5, 92, 93, 94, 95, 96, 99, 100, 101, 102]

function buildType(total, type, publicIds) {
  const publicSet = new Set(publicIds)
  return Array.from({ length: total }, (_, i) => {
    const seq = i + 1
    return {
      id: `${type}${seq}`, // 例：大1、小12、無障礙3
      type,
      seq,
      public: publicSet.has(seq),
    }
  })
}

// 產生 655 筆車位主檔。
export function buildSpaces() {
  return [
    ...buildType(GENERAL_LARGE_TOTAL, SPACE_TYPE.LARGE, PUBLIC_LARGE),
    ...buildType(GENERAL_SMALL_TOTAL, SPACE_TYPE.SMALL, PUBLIC_SMALL),
    ...buildType(ACCESSIBLE_TOTAL, SPACE_TYPE.ACCESSIBLE, []),
  ]
}

// 可供個人承租的車位（排除公益）。
export function rentableSpaces(spaces = buildSpaces()) {
  return spaces.filter((s) => !s.public)
}
