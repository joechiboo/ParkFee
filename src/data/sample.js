// 範例名冊產生器（確定性，不用亂數）— 供 UI 一鍵載入示範、開發與測試。
// 產出「長表」原始列（未正規化），走 buildRoster 後即可餵配位引擎。
import { SOURCE } from './registry.js'

const BUILDINGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// 產生 n 戶登記。約 1/12 身障、1/4 志願小位、1/15 重機、1/40 社宅（限公益位）、
// 約 1/3 有第 2 輛、少數第 3 輛、1/2 勾電腦選號。線上／紙本交錯，示範雙管道。
// 車輛數 ≈ n × 1.45（n=277 → ≈401 台，貼近實際使用 ~400）。
export function sampleRoster(households = 120) {
  const rows = []
  let serial = 0
  for (let i = 0; i < households; i++) {
    const b = BUILDINGS[i % BUILDINGS.length]
    const floor = (i % 14) + 2 // 2..15
    const unit = (Math.floor(i / 56) % 6) + 1 // 棟×樓 每 56 戶循環一輪 → 戶別進位，戶號唯一撐到 336 戶
    const 戶號 = `${b}${floor}-${unit}`
    const 電話 = `09${String(10000000 + i * 137).slice(0, 8)}`
    const 來源 = i % 5 === 0 ? SOURCE.PAPER : SOURCE.ONLINE
    const stamp = (n) => `2026-11-${String(15 + (i % 15)).padStart(2, '0')} ${String(8 + (i % 9)).padStart(2, '0')}:${String((serial += 1) % 60).padStart(2, '0')}:00`

    const heavy = i % 15 === 0
    const disabled = i % 12 === 0
    const small = !heavy && i % 4 === 0
    const social = i % 40 === 0 ? '是' : '否' // 社會住宅住戶（限公益位）
    const fallback = i % 2 === 0 ? '是' : '否' // 電腦選號（志願落空自動配本棟剩位）

    // 第 1 輛（必填）
    rows.push({
      戶號,
      車號: plate(serial),
      車種: heavy ? '重機（250CC↑）' : '一般（≤250CC）',
      第幾輛: 1,
      身障: disabled ? '是' : '否',
      志願小位: small ? '是' : '否',
      登記時間: stamp(1),
      聯絡電話: 電話,
      志願落選保底: fallback,
      社宅: social,
      來源,
    })
    // 第 2 輛（約 1/3）
    if (i % 3 === 0) {
      rows.push({
        戶號,
        車號: plate(serial + 1000),
        車種: '一般（≤250CC）',
        第幾輛: 2,
        身障: '否',
        志願小位: i % 8 === 0 ? '是' : '否',
        登記時間: stamp(2),
        聯絡電話: 電話,
        志願落選保底: fallback,
        社宅: social,
        來源,
      })
    }
    // 第 3 輛（少數）
    if (i % 9 === 0) {
      rows.push({
        戶號,
        車號: plate(serial + 2000),
        車種: '一般（≤250CC）',
        第幾輛: 3,
        身障: '否',
        志願小位: '否',
        登記時間: stamp(3),
        聯絡電話: 電話,
        志願落選保底: fallback,
        社宅: social,
        來源,
      })
    }
  }
  return rows
}

// 由序號生成像樣的台灣機車車牌（字母3 + 數字4），確定性。
function plate(n) {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const a = L[(n * 7) % 24]
  const b = L[(n * 13) % 24]
  const c = L[(n * 17) % 24]
  const num = String(1000 + ((n * 1234) % 9000))
  return `${a}${b}${c}-${num}`
}
