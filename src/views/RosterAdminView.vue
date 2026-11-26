<script setup>
// 登記名冊（管理員）：看目前全部登記、匯出、代改登記內容、更正戶號。
// 2026-11-10 使用者定：這些不要塞在車位維護頁，獨立一頁。
// 資料來源 rename-household op=list（整戶含電話，後端每次撈都寫稽核）。
// 代改登記沿用登記頁的編輯模式（editTarget.adminEdit），不另做一套表單。
// 2026-11-17：警示可標「已處理」（存 roster_review，整列沒有未處理的改淺綠）。
// 2026-11-16：加「需聯繫」警示（戶號有誤、車號不是車牌、同一台車兩戶、車號只差一字、同電話多戶，規則在 roster-warnings.js）與刪除整戶。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listHouseholds, renameHousehold, deleteHousehold, reviewWarning, lockedSeats, refreshLocked } from '../store/locked.js'
import { motorSeats } from '../map/seats.js'
import { rosterWarningItems, RED_TYPES } from '../data/roster-warnings.js'
import { editTarget } from '../store/editTarget.js'
import { normalizeHousehold, householdProblem, isTestHousehold } from '../data/household.js'
import { toCSV } from '../data/csv.js'
import { KIND, displaySeatIds } from '../map/seat-id.js'

const router = useRouter()
const households = ref([])
const loading = ref(false)
const err = ref('')
const keyword = ref('')
const onlyProblem = ref(false)
const showResolved = ref(false) // 只看需聯繫確認時，要不要連已處理的一起列（回頭查用）
const reviews = ref(new Map()) // `${戶號}|${種類}` → { note, at }（名冊警示已處理，2026-11-17）

// 戶號自然排序：棟別字母 → 房型編號 → 樓層；工作人員等排最後。
const hidKey = (h) => {
  const m = String(h || '').match(/^([A-Z])(\d+)-(\d+)$/)
  return m ? [0, m[1], +m[2], +m[3]] : [1, String(h || ''), 0, 0]
}
const byHid = (a, b) => {
  const x = hidKey(a.戶號)
  const y = hidKey(b.戶號)
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

async function reload() {
  loading.value = true
  err.value = ''
  try {
    const [r] = await Promise.all([listHouseholds(), refreshLocked()])
    households.value = r.households.sort(byHid)
    reviews.value = new Map(r.reviews.map((x) => [`${x.戶號}|${x.type}`, x]))
  } catch (e) {
    err.value = e?.message || '讀取名冊失敗'
  } finally {
    loading.value = false
  }
}
onMounted(reload)

const isBike = (v) => v.車種 === KIND.BIKE
const plateText = (v) => (isBike(v) ? `自行車 第 ${v.第幾輛} 輛${v.特徵 ? `（${v.特徵}）` : ''}` : v.車號)
const problemOf = (h) => householdProblem(h.戶號)
const allMotorSeats = motorSeats()
// 每戶的警示，標上是否已處理：[{ type, text, review }]
const warnings = computed(() => {
  const out = new Map()
  for (const [hid, items] of rosterWarningItems(households.value, { seats: allMotorSeats, locked: lockedSeats.value }))
    // 紅色警示（志願小位對不上等）不吃「已處理」：資料改好才會消失（2026-11-26）。
    out.set(hid, items.map((w) => ({ ...w, red: RED_TYPES.has(w.type), review: RED_TYPES.has(w.type) ? null : reviews.value.get(`${hid}|${w.type}`) || null })))
  return out
})
const openWarns = (hid) => (warnings.value.get(hid) || []).filter((w) => !w.review)

const rows = computed(() => {
  const k = keyword.value.trim().toUpperCase()
  return households.value
    .map((h) => {
      const warns = warnings.value.get(h.戶號) || []
    const fmtReview = (w) => `${w.text.replace(/。.*/, '')}（${w.review.note || '已確認'}）`
      return { ...h, problem: problemOf(h), warns, open: warns.filter((w) => !w.review).length, red: warns.some((w) => w.red), test: isTestHousehold(h.戶號) }
    })
    .filter((h) => !onlyProblem.value || h.open || (showResolved.value && h.warns.length))
    .filter(
      (h) =>
        !k ||
        h.戶號.toUpperCase().includes(k) ||
        String(h.電話 || '').replace(/-/g, '').includes(k.replace(/-/g, '')) ||
        (h.vehicles || []).some((v) => String(v.車號).toUpperCase().includes(k)),
    )
})
const stats = computed(() => {
  const vs = households.value.flatMap((h) => h.vehicles || [])
  return {
    戶: households.value.length,
    一般: vs.filter((v) => v.車種 === '一般').length,
    重機: vs.filter((v) => v.車種 === '重機').length,
    自行車: vs.filter(isBike).length,
    有誤: households.value.filter((h) => openWarns(h.戶號).length).length,
    紅: households.value.filter((h) => (warnings.value.get(h.戶號) || []).some((w) => w.red)).length,
    已處理: households.value.filter((h) => (warnings.value.get(h.戶號) || []).length && !openWarns(h.戶號).length).length,
  }
})

// ── 匯出：一台車一列，Excel 可直接開（UTF-8 BOM）。要聯繫住戶確認的戶，「需聯繫確認」欄寫原因。──
const EXPORT_COLUMNS = ['戶號', '需聯繫確認', '已處理', '聯絡電話', '登記時間', '車號', '車種', '第幾輛', '身障', '志願小位', '已選定車位', '配位狀態', '已繳費', '志願數', '電腦選號', '工作人員']
const fmtTime = (t) => {
  if (!t) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return String(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function exportCsv() {
  const out = []
  for (const h of households.value) {
    const warns = warnings.value.get(h.戶號) || []
    for (const v of h.vehicles?.length ? h.vehicles : [{}]) {
      out.push({
        戶號: h.戶號,
        需聯繫確認: warns.filter((w) => !w.review).map((w) => w.text).join('；'),
        已處理: warns.filter((w) => w.review).map(fmtReview).join('；'),
        聯絡電話: h.電話 ? `="${h.電話}"` : '', // 包成公式字串，Excel 才不會吃掉開頭的 0
        登記時間: fmtTime(h.createdAt),
        車號: v.車號 ? plateText(v) : '',
        車種: v.車種 || '',
        第幾輛: v.第幾輛 ?? '',
        身障: v.身障 ? '是' : '',
        志願小位: v.志願小位 ? '是' : '',
        已選定車位: v.車位編號 ? displaySeatIds(v.車位編號) : '',
        配位狀態: v.配位狀態 || '',
        已繳費: v.已繳費 ? '是' : '',
        志願數: (h.車位志願 || []).length || '',
        電腦選號: h.志願落選保底 ? '同意' : '不同意',
        工作人員: h.工作人員 ? '是' : '',
      })
    }
  }
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const blob = new Blob(['﻿' + toCSV(out, EXPORT_COLUMNS)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `登記名冊-${stamp}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── 代改登記：帶整戶資料進登記頁的編輯模式，送出時用管理員憑證 ──
function edit(h) {
  editTarget.value = { ...h, adminEdit: true }
  router.push('/register')
}

// ── 警示已處理：秘書聯繫住戶確認後，在右邊「維護」欄按一次，這一戶所有未處理的警示一起標記（可寫備註）。
//    該條改灰、整列改淺綠；按「取消已處理」整戶還原。（11/17 使用者要求按鈕跟其他維護按鈕放一起）──
async function markReviewed(h) {
  // 紅色警示不能標已處理：資料沒改好，抽籤照樣出錯。
  const open = h.warns.filter((w) => !w.review && !w.red)
  if (!open.length) {
    if (h.red) alert('紅色警示要把資料改好（勾回志願小位或解除車位）才會消失，不能標記已處理。')
    return
  }
  const list = open.map((w) => '・' + w.text.replace(/。.*/, '')).join('\n')
  const note = prompt(`${h.戶號}：標記為已處理
${list}

可寫備註（例：家人代填、電動機車真車牌），也可留空：`, '')
  if (note == null) return
  await saveReview(h, open, { done: true, note })
}
async function unmarkReviewed(h) {
  const done = h.warns.filter((w) => w.review)
  if (!done.length || !confirm(`取消 ${h.戶號} 的「已處理」？`)) return
  await saveReview(h, done, { done: false })
}
async function saveReview(h, list, opts) {
  saving.value = true
  renameMsg.value = ''
  const next = new Map(reviews.value)
  try {
    for (const w of list) {
      await reviewWarning(h.戶號, w.type, opts)
      const key = `${h.戶號}|${w.type}`
      if (opts.done) next.set(key, { 戶號: h.戶號, type: w.type, note: opts.note || '', at: new Date().toISOString() })
      else next.delete(key)
    }
  } catch (e) {
    renameMsg.value = e?.message || '儲存失敗'
  } finally {
    reviews.value = next // 中途失敗也保留已成功的那幾條
    saving.value = false
  }
}
const fmtDay = (t) => {
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`
}

// ── 刪除整戶：確認是重複登記或不是住戶時用。已繳費的車後端會拒絕；佔的車位一併放回可選。
//    要求再打一次戶號才刪，避免點錯列。刪錯可從每日備份快照查回內容後重新登記。──
async function doDelete(h) {
  const cars = (h.vehicles || []).map((v) => plateText(v) + (v.車位編號 ? `（車位 ${displaySeatIds(v.車位編號)}）` : '')).join('、') || '無'
  const typed = prompt(`確定要刪除 ${h.戶號} 整筆登記？
車輛：${cars}
佔用的車位會放回可選。刪除後無法復原。

請再輸入一次戶號「${h.戶號}」確認：`)
  if (typed == null) return
  if (typed.trim().toUpperCase() !== h.戶號.toUpperCase()) {
    renameMsg.value = '輸入的戶號不一致，沒有刪除'
    return
  }
  saving.value = true
  renameMsg.value = ''
  try {
    const r = await deleteHousehold(h.戶號)
    await reload()
    renameMsg.value = `已刪除 ${r.戶號}（${r.車輛數} 台車${r.釋出車位?.length ? `，車位 ${r.釋出車位.map((x) => displaySeatIds(x)).join('、')} 已放回可選` : ''}）。`
  } catch (e) {
    renameMsg.value = e?.message || '刪除失敗'
  } finally {
    saving.value = false
  }
}

// ── 更正戶號：整戶的車、志願、車位、繳費紀錄一起搬；新戶號已有登記時後端拒絕 ──
const renaming = ref('') // 正在更正的原戶號
const renameTo = ref('')
const renameMsg = ref('')
const saving = ref(false)
const renameProblem = computed(() => (renameTo.value.trim() ? householdProblem(renameTo.value) : null))
function startRename(h) {
  renaming.value = h.戶號
  renameTo.value = ''
  renameMsg.value = ''
}
async function doRename() {
  const oldId = renaming.value
  const newId = normalizeHousehold(renameTo.value)
  if (!oldId || !newId || renameProblem.value) return
  if (!confirm(`把戶號「${oldId}」更正為「${newId}」？\n這一戶的車輛、志願、車位、繳費紀錄會一起搬過去。`)) return
  saving.value = true
  renameMsg.value = ''
  try {
    const r = await renameHousehold(oldId, newId)
    renaming.value = ''
    await reload()
    renameMsg.value = `已把 ${oldId} 更正為 ${r.戶號}。請通知住戶之後用新戶號登入。`
  } catch (e) {
    renameMsg.value = e?.message || '更正失敗'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section>
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">登記名冊</h1>
        <p class="mt-1 text-sm text-slate-500">
          目前全部登記。可匯出、代住戶修改登記內容、更正填錯的戶號、刪除重複登記。黃底是需要聯繫住戶確認的戶，紅字寫要確認什麼。內含電話與車號，請勿外流。
        </p>
      </div>
      <div class="flex gap-2">
        <button class="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50" :disabled="loading" @click="reload">
          {{ loading ? '讀取中…' : '重新整理' }}
        </button>
        <button class="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50" :disabled="!households.length" @click="exportCsv">
          ⬇ 匯出 Excel（CSV）
        </button>
      </div>
    </div>

    <p v-if="err" class="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ err }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <span><b>{{ stats.戶 }}</b> 戶</span>
      <span>一般機車 <b>{{ stats.一般 }}</b></span>
      <span>重機 <b>{{ stats.重機 }}</b></span>
      <span>自行車 <b>{{ stats.自行車 }}</b></span>
      <span v-if="stats.紅" class="rounded bg-red-200 px-2 py-0.5 font-medium text-red-900">抽籤前必須處理 {{ stats.紅 }} 戶</span>
      <span v-if="stats.有誤" class="rounded bg-yellow-200 px-2 py-0.5 font-medium text-yellow-900">需聯繫確認 {{ stats.有誤 }} 戶</span>
      <span v-if="stats.已處理" class="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">已處理 {{ stats.已處理 }} 戶</span>
      <span class="ml-auto flex flex-wrap items-center gap-3">
        <label class="flex cursor-pointer items-center gap-1 text-slate-600">
          <input v-model="onlyProblem" type="checkbox" /> 只看需聯繫確認
        </label>
        <label v-if="onlyProblem" class="flex cursor-pointer items-center gap-1 text-slate-600">
          <input v-model="showResolved" type="checkbox" /> 含已處理
        </label>
        <input v-model="keyword" type="search" placeholder="搜尋戶號／車號／電話" class="w-52 rounded border border-slate-300 px-2 py-1 text-sm" />
      </span>
    </div>

    <p v-if="renameMsg" class="mt-3 rounded border border-sky-200 bg-sky-50 p-2 text-sm text-sky-900">{{ renameMsg }}</p>

    <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="w-full text-sm">
        <thead class="bg-slate-100 text-left text-xs text-slate-600">
          <tr>
            <th class="px-3 py-2">戶號</th>
            <th class="px-3 py-2">電話</th>
            <th class="px-3 py-2">車輛</th>
            <th class="px-3 py-2">志願</th>
            <th class="px-3 py-2">登記時間</th>
            <th class="px-3 py-2 text-right">維護</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="h in rows" :key="h.戶號">
            <tr class="border-t border-slate-100 align-top" :class="h.red ? 'bg-red-100' : h.open ? 'bg-yellow-100' : h.warns.length ? 'bg-emerald-50' : ''">
              <td class="px-3 py-2">
                <b class="font-mono">{{ h.戶號 }}</b>
                <span v-if="h.工作人員" class="ml-1 rounded bg-slate-200 px-1 text-xs">工作人員</span>
                <span v-if="h.test" class="ml-1 rounded bg-rose-200 px-1 text-xs text-rose-900">測試</span>
                <ul v-if="h.warns.length" class="mt-1 max-w-md space-y-1 text-xs">
                  <li v-for="w in h.warns" :key="w.text">
                    <template v-if="!w.review">
                      <span :class="w.red ? 'font-semibold text-red-800' : 'text-red-700'">{{ w.red ? '🔴 抽籤前必須處理：' : '• ' }}{{ w.text }}</span>
                    </template>
                    <template v-else>
                      <span class="text-slate-400 line-through">• {{ w.text.replace(/。.*/, '') }}</span>
                      <span class="ml-1 text-emerald-700">✓ 已處理{{ w.review.note ? `：${w.review.note}` : '' }}（{{ fmtDay(w.review.at) }}）</span>
                    </template>
                  </li>
                </ul>
              </td>
              <td class="whitespace-nowrap px-3 py-2 font-mono text-xs">{{ h.電話 || '—' }}</td>
              <td class="px-3 py-2">
                <div v-for="v in h.vehicles" :key="v.車號" class="whitespace-nowrap">
                  <span class="font-mono">{{ plateText(v) }}</span>
                  <span v-if="!isBike(v)" class="ml-1 text-xs text-slate-500">{{ v.車種 }}</span>
                  <span v-if="v.身障" class="ml-1 rounded bg-sky-100 px-1 text-xs text-sky-800">身障</span>
                  <span v-if="v.志願小位" class="ml-1 rounded bg-emerald-100 px-1 text-xs text-emerald-800">志願小位</span>
                  <span v-if="v.車位編號" class="ml-1 rounded bg-indigo-100 px-1 text-xs text-indigo-800">
                    車位 {{ displaySeatIds(v.車位編號) }}{{ v.已繳費 ? '・已繳' : '' }}
                  </span>
                </div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                {{ (h.車位志願 || []).length ? `${h.車位志願.length} 個` : '未排' }}・電腦選號{{ h.志願落選保底 ? '同意' : '不同意' }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{{ fmtTime(h.createdAt) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right">
                <button v-if="h.open" class="mr-1 rounded border border-emerald-500 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50" :disabled="saving" @click="markReviewed(h)">已處理</button>
                <button v-else-if="h.warns.length" class="mr-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50" :disabled="saving" @click="unmarkReviewed(h)">取消已處理</button>
                <button class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="edit(h)">修改登記</button>
                <button class="ml-1 rounded border border-sky-400 px-2 py-1 text-xs text-sky-700 hover:bg-sky-50" @click="startRename(h)">更正戶號</button>
                <button class="ml-1 rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50" @click="doDelete(h)">刪除</button>
              </td>
            </tr>
            <tr v-if="renaming === h.戶號" class="border-t border-sky-100 bg-sky-50">
              <td colspan="6" class="px-3 py-3">
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <span>把 <b class="font-mono">{{ h.戶號 }}</b> 更正為</span>
                  <input
                    v-model="renameTo"
                    type="text"
                    placeholder="正確戶號，例 B2-14"
                    style="text-transform: uppercase"
                    class="w-44 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    @keyup.enter="doRename"
                  />
                  <button
                    class="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    :disabled="saving || !renameTo.trim() || !!renameProblem"
                    @click="doRename"
                  >更正</button>
                  <button class="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-white" @click="renaming = ''">取消</button>
                  <span class="text-xs text-slate-500">戶號＝房型-樓層，H3 房型 6 樓是 H3-6。車輛、志願、車位、繳費紀錄會一起搬。</span>
                </div>
                <p v-if="renameProblem" class="mt-1 text-xs text-red-600">{{ renameProblem }}</p>
              </td>
            </tr>
          </template>
          <tr v-if="!rows.length && !loading">
            <td colspan="6" class="px-3 py-6 text-center text-slate-400">{{ households.length ? '沒有符合條件的登記' : '目前沒有登記' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
