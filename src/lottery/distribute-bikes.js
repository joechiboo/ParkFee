// 自行車配位引擎 — 純函式、固定 seed → 可重現、可稽核。
//
// 與機車分開一支的理由：辦法對兩者的規定本來就不同。
//   機車走「填志願 + 統一分發」（決策 A2），那是**刻意偏離辦法**的設計，故需 Q2 修條文用語。
//   自行車照辦法伍三字面即可：(三)(六) 明寫「抽車位號碼」「採取抽車位資格」→ **直接抽車位，不填志願**。
//   自行車位無型別差異（無大/小位、無無障礙、無重機），志願能表達的只有遠近，
//   而 159 個可租位對 655 戶，多數人抽不到，排志願序對絕大多數住戶是白填的。
// 分成兩支也讓 12/1 機車抽籤的程式路徑完全不受自行車影響。
//
// 輪次（辦法伍三(四)）：抽籤順序由每戶第一輛開始；第一輛程序完結後如有剩餘，再辦第二輛。
// 候補（辦法伍三(三)＋決策 Q1）：順序號即候補序，不另抽候補籤。
// 社宅（Q17，待管委會確認）：公益自行車位 114–118 比照機車公益位＝社宅戶專用。
//   由 socialHousingPublicOnly 控制，管委會若否決此類推即可關掉。
//
// 車位編號為 B001–B164 的正規形（見 map/seat-id.js）；顯示給住戶時用 displaySeatId() 剝回地面數字。

import { mulberry32, hashSeed, seededShuffle } from './rng.js'
import { bikeSeats, PUBLIC_BIKE_IDS } from '../map/seats.js'
import { KIND, compareSeatId, toBikeId } from '../map/seat-id.js'
import { REASON, VIA } from './distribute.js'

export const BIKE_VIA = {
  DRAW: '抽籤', // 依辦法抽車位號碼
  PRESET: '物業指派', // 抽籤前已指派（保留/臨櫃辦理），免抽、直接記入結果
  STAFF: VIA.STAFF, // 工作人員：住戶全部配完後撿剩位（與機車同字串 → 公告版同一條規則濾掉）
}

export const BIKE_REASON = {
  SHORT: '車位不足', // 順序號在可用車位數之後 → 候補
  // 兩輪抽籤第一輪（12/1）：第 2 輛起本輪不抽，不算候補。與機車共用同一字串，匯出時才會轉成狀態「待第二輪」。
  NEXT_STAGE: REASON.NEXT_STAGE,
  // 工作人員：還有住戶候補時一律暫緩（2026-11-27 使用者定比照機車：工作人員自行車排全體住戶之後）。
  STAFF_PENDING: REASON.STAFF_PENDING,
}

const PUBLIC_SET = new Set(PUBLIC_BIKE_IDS)

function toEntry(r, index) {
  const 車位 = String(r.車位編號 ?? '').trim()
  return {
    戶號: String(r.戶號),
    車號: String(r.車號 ?? ''), // 自行車為合成鍵（自行車-<戶號>-<序>），住戶不需知道
    第幾輛: Number(r.第幾輛) || 1,
    // 物業抽籤前已指派（空＝待抽）。一律轉正規形 B0xx：發佈結果寫回 vehicle 的是剝掉前綴的地面號碼（23），
    // 第二輪重新匯出名冊後若不轉回 B023，就無法把該格移出池，會把同一格再配給別人。
    車位編號: 車位 ? toBikeId(車位) || 車位 : '',
    已繳費: r.已繳費 === true || r.已繳費 === 'Y' || r.已繳費 === 'y',
    社宅: r.社宅 === true || r.社宅 === 'Y' || r.社宅 === 'y',
    工作人員: r.工作人員 === true || r.工作人員 === 'Y' || r.工作人員 === 'y',
    特徵: String(r.特徵 ?? ''),
    _order: index,
  }
}

// 戶別 → 可用車位資格。社宅戶只配公益位、一般戶只配非公益位（比照 Q7，見檔頭）。
function eligibleFor(e, socialHousingPublicOnly) {
  if (!socialHousingPublicOnly) return () => true
  return (id) => (e.社宅 ? PUBLIC_SET.has(id) : !PUBLIC_SET.has(id))
}

export function distributeBikes({
  registrations,
  seats = bikeSeats(),
  seed = 'parkfee-bike',
  runAt = null,
  socialHousingPublicOnly = true,
  // 兩輪抽籤（2026-11-24 使用者定：自行車第 2 輛起比照機車留到第二輪）。
  //   stage 1（12/1）：只抽每戶第 1 輛；第 2 輛起列「待第二輪」，不抽、不算候補。
  //   stage 2（12/15）：名冊用第一輪發佈後重新匯出的，第一輪抽中者帶車位編號走已指派；
  //     其餘依第幾輛分輪抽（第一輪候補的第 1 輛排在第 2 輛之前），順序號用 seqStart 接續第一輪。
  //   'all'（預設）：一次跑完，供每月演練與既有測試；行為與加 stage 前完全相同。
  stage = 'all',
  seqStart = 0,
}) {
  const STAGE = stage === 1 || stage === '1' ? 1 : stage === 2 || stage === '2' ? 2 : 'all'
  const rng = mulberry32(hashSeed(seed))

  // 只處理自行車列；同一份名冊可混機車，由本函式自行篩掉。
  const entries = registrations
    .filter((r) => r.車種 === KIND.BIKE)
    .map(toEntry)

  const available = new Set(seats.map((s) => String(s.id)))
  const assigned = []
  const lost = []
  const rounds = []
  const log = []
  const say = (m) => log.push(m)

  const record = (e, id, via, round, seqNo = null) => {
    assigned.push({
      戶號: e.戶號,
      車號: e.車號,
      車種: KIND.BIKE,
      第幾輛: e.第幾輛,
      車位編號: id,
      車位類型: KIND.BIKE, // 匯出 CSV 靠此欄區分車種（RESULT_COLUMNS 無車種欄）
      占用位數: 1,
      配位方式: via,
      順序號: seqNo,
      輪次: round,
      已繳費: !!e.已繳費, // 自行車免費（辦法柒二）→ 此旗標僅供物業標記臨櫃辦妥
      特徵: e.特徵,
    })
  }

  // ── 已指派（物業抽籤前確定：保留位、臨櫃辦理）──────────────────
  const preset = entries.filter((e) => e.車位編號)
  let pending = entries.filter((e) => !e.車位編號)
  // 工作人員排全體住戶之後（2026-11-27 使用者定，比照機車辦法伍二（十二））：先抽離，住戶各輪辦完才處理。
  let staff = pending.filter((e) => e.工作人員)
  pending = pending.filter((e) => !e.工作人員)
  const waiting = []
  const wait = (e) => ({ 戶號: e.戶號, 車號: e.車號, 車種: KIND.BIKE, 第幾輛: e.第幾輛, 原因: BIKE_REASON.NEXT_STAGE, ...(e.工作人員 ? { 工作人員: true } : {}) })
  if (STAGE === 1) {
    for (const e of pending.filter((x) => x.第幾輛 !== 1)) waiting.push(wait(e))
    pending = pending.filter((x) => x.第幾輛 === 1)
    for (const e of staff) waiting.push(wait(e)) // 第一輪工作人員一律不抽
    staff = []
  }
  if (preset.length) {
    const a = []
    for (const e of preset) {
      available.delete(e.車位編號) // 防呆：確定移出池，避免重複分配
      record(e, e.車位編號, BIKE_VIA.PRESET, 0)
      a.push({ 戶號: e.戶號, 車位編號: e.車位編號, 配位方式: BIKE_VIA.PRESET })
    }
    say(`已指派（物業抽籤前確定）：${preset.length} 台，免抽、直接記入結果`)
    rounds.push({ round: '指派', name: '物業指派（免抽）', draws: [], assignments: a })
  }

  // ── 各輪：第 1 輛 → 第 2 輛（辦法伍三(四)：前一輪完結後仍有剩餘才辦下一輪）──
  // 順序號跨輪連續累加，每台抽籤車一個唯一號、不重來 → 順序號即候補序。
  let seqCounter = Number(seqStart) || 0
  const nths = [...new Set(pending.map((e) => e.第幾輛))].sort((x, y) => x - y)

  // 抽一組（住戶的某一輪、或工作人員）：洗牌定順序號，依序從洗牌後的池取位；取不到列候補。
  function drawGroup(cands, roundKey, name, via) {
    if (!cands.length) return
    if (!available.size) {
      // 車位已發完 → 本組全數列候補，仍給順序號以定候補序。
      const rest = seededShuffle(cands, rng)
      for (const e of rest) {
        const seq = ++seqCounter
        lost.push({ 戶號: e.戶號, 車號: e.車號, 第幾輛: e.第幾輛, 輪次: roundKey, 順序號: seq, 原因: BIKE_REASON.SHORT, ...(e.工作人員 ? { 工作人員: true } : {}) })
      }
      say(`${name}：車位已發完，${rest.length} 台全列候補`)
      return
    }

    // 住戶洗牌 → 順序號；車位另行洗牌 → 依序發放。
    // 車位也洗牌是刻意的：若車位按編號序發，「順序號小」會固定拿到「編號小」的位置，
    // 位置優劣就與抽籤名次系統性綁定。兩邊都洗牌後，抽到的號碼才是真的隨機。
    const order = seededShuffle(cands, rng)
    const pool = seededShuffle([...available].sort(compareSeatId), rng)

    const draws = []
    const a = []
    let cursor = 0
    for (let i = 0; i < order.length; i++) {
      const e = order[i]
      const seq = ++seqCounter
      const ok = eligibleFor(e, socialHousingPublicOnly)

      // 從洗牌後的池中取第一個資格相符者（社宅↔公益位分流）。
      // cursor 先跳過已被取走的位；資格不符者不動 cursor（下一位住戶可能吃得到）。
      while (cursor < pool.length && !available.has(pool[cursor])) cursor++
      let picked = null
      for (let k = cursor; k < pool.length; k++) {
        const id = pool[k]
        if (!available.has(id) || !ok(id)) continue
        picked = id
        break
      }

      draws.push({ 戶號: e.戶號, 車號: e.車號, 順序號: seq, 中籤: !!picked })
      if (!picked) {
        lost.push({ 戶號: e.戶號, 車號: e.車號, 第幾輛: e.第幾輛, 輪次: roundKey, 順序號: seq, 原因: BIKE_REASON.SHORT, ...(e.工作人員 ? { 工作人員: true } : {}) })
        continue
      }
      available.delete(picked)
      record(e, picked, via, roundKey, seq)
      a.push({ 戶號: e.戶號, 車位編號: picked, 順序號: seq, 配位方式: via })
    }

    say(`${name}：登記 ${cands.length}，配出 ${a.length}，候補 ${cands.length - a.length}，剩餘 ${available.size}`)
    rounds.push({ round: roundKey, name, draws, assignments: a })
  }

  // 候選＝本輪序號的車。「一戶一位」不適用自行車：辦法伍三(四) 是「第一輛全部辦完、
  // 有剩餘才辦第二輛」，同一戶本來就可能同時有第一與第二輛，由 第幾輛 分輪即可。
  for (const nth of nths) drawGroup(pending.filter((e) => e.第幾輛 === nth), nth, `R${nth} 第 ${nth} 輛自行車`, BIKE_VIA.DRAW)

  // 工作人員（第二輪／一次跑完）：還有住戶候補 → 全數暫緩，不搶住戶的候補位；住戶都配到才撿剩位。
  if (staff.length) {
    const residentShort = lost.some((l) => l.原因 === BIKE_REASON.SHORT && !l.工作人員)
    if (residentShort) {
      for (const e of staff)
        lost.push({ 戶號: e.戶號, 車號: e.車號, 第幾輛: e.第幾輛, 輪次: '工作人員', 順序號: null, 原因: BIKE_REASON.STAFF_PENDING, 工作人員: true })
      say(`工作人員：尚有住戶候補，${staff.length} 台暫緩`)
    } else {
      drawGroup([...staff].sort((x, y) => x.第幾輛 - y.第幾輛), '工作人員', '工作人員（住戶配完後之剩餘位）', BIKE_VIA.STAFF)
    }
  }

  if (waiting.length) say(`待第二輪：${waiting.length} 台（第 2 輛起，12/15 再抽）`)

  return {
    seed,
    seedHash: hashSeed(seed),
    runAt,
    stage: STAGE,
    rounds,
    assigned,
    落選: lost, // 順序號即候補序（辦法伍三(三)＋Q1）
    待安排: waiting, // 第一輪的第 2 輛起（原因＝待第二輪再分配）
    log,
    summary: {
      registrations: entries.length,
      assigned: assigned.length,
      落選: lost.length,
      待第二輪: waiting.length,
      remaining: available.size,
      順序號迄: seqCounter, // 第二輪的 seqStart 填這個數
    },
  }
}
