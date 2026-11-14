<script setup>
// 登記名冊（管理員）：看目前全部登記、匯出、代改登記內容、更正戶號。
// 2026-11-10 使用者定：這些不要塞在車位維護頁，獨立一頁。
// 資料來源 rename-household op=list（整戶含電話，後端每次撈都寫稽核）。
// 代改登記沿用登記頁的編輯模式（editTarget.adminEdit），不另做一套表單。
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { listHouseholds, renameHousehold } from '../store/locked.js'
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
    households.value = (await listHouseholds()).sort(byHid)
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

const rows = computed(() => {
  const k = keyword.value.trim().toUpperCase()
  return households.value
    .map((h) => ({ ...h, problem: problemOf(h), test: isTestHousehold(h.戶號) }))
    .filter((h) => !onlyProblem.value || h.problem)
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
    有誤: households.value.filter(problemOf).length,
  }
})

// ── 匯出：一台車一列，Excel 可直接開（UTF-8 BOM）。戶號有誤的列在「戶號檢核」欄有說明。──
const EXPORT_COLUMNS = ['戶號', '戶號檢核', '聯絡電話', '登記時間', '車號', '車種', '第幾輛', '身障', '志願小位', '已選定車位', '配位狀態', '已繳費', '志願數', '電腦選號', '工作人員']
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
    const problem = problemOf(h)
    for (const v of h.vehicles?.length ? h.vehicles : [{}]) {
      out.push({
        戶號: h.戶號,
        戶號檢核: problem ? `戶號有誤：${problem}` : '',
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
          目前全部登記。可匯出、代住戶修改登記內容、更正填錯的戶號。內含電話與車號，請勿外流。
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
      <span v-if="stats.有誤" class="rounded bg-yellow-200 px-2 py-0.5 font-medium text-yellow-900">戶號有誤 {{ stats.有誤 }} 戶</span>
      <span class="ml-auto flex flex-wrap items-center gap-3">
        <label class="flex cursor-pointer items-center gap-1 text-slate-600">
          <input v-model="onlyProblem" type="checkbox" /> 只看戶號有誤
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
            <tr class="border-t border-slate-100 align-top" :class="h.problem ? 'bg-yellow-100' : ''">
              <td class="px-3 py-2">
                <b class="font-mono">{{ h.戶號 }}</b>
                <span v-if="h.工作人員" class="ml-1 rounded bg-slate-200 px-1 text-xs">工作人員</span>
                <span v-if="h.test" class="ml-1 rounded bg-rose-200 px-1 text-xs text-rose-900">測試</span>
                <div v-if="h.problem" class="mt-0.5 max-w-xs text-xs text-red-700">{{ h.problem }}</div>
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
                <button class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="edit(h)">修改登記</button>
                <button class="ml-1 rounded border border-sky-400 px-2 py-1 text-xs text-sky-700 hover:bg-sky-50" @click="startRename(h)">更正戶號</button>
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
