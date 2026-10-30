<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import SeatMap from '../components/SeatMap.vue'
import { motorSeats } from '../map/seats.js'
import { sessionHousehold, sessionPlate } from '../store/session.js'
import { saveWishes as saveWishesRemote, claimSeat as claimSeatRemote } from '../store/db.js'
import { lockedSeats, refreshLocked } from '../store/locked.js'
import { feeFor } from '../data/fee.js'

// 全機車位（含 public 旗標）。可選資格（2026-08-16 決議）：
//   一般戶＝大/小；重機戶＝大位（占相鄰兩個大位，配位自動帶鄰格；2026-10-29 起不得選無障礙位、不含小位）；
//   社宅戶＝僅公益位（10/20 起社宅不登記，公益位改由物業整批鎖定）；無障礙位限身障者、由管理中心指派，地圖上一律不可選。
const seats = motorSeats()
const householdId = computed(() => sessionHousehold.value?.戶號 || '')

// 志願序＝純綁登入住戶：來源為登入時後端帶回的 車位志願（sessionHousehold）；未登入時為記憶體試排。
// 不寫任何裝置儲存 → 同台電腦換住戶/登出即歸零，不會看到上一位的志願。點選順序即志願序。
const wishes = ref(sessionHousehold.value?.車位志願?.map(String) || [])
// 電腦選號：志願全落選時是否由系統自動配本棟靠電梯剩位。payload 欄位仍沿用 志願落選保底（後端相容）。
// 預設**打勾**：8/27 模擬顯示未勾者在志願落空後多半整輪配不到（84/183 台落選、場上卻還剩 507 格）。
// 判斷依據是「以前存過志願沒有」而非旗標值本身——後端回的一律是布林 false，
// 用 ?? 判斷的話剛登記完的人永遠套不到預設。存過志願者沿用自己的選擇。
const computerPick = ref(
  sessionHousehold.value?.車位志願?.length
    ? !!sessionHousehold.value.志願落選保底
    : true,
)
const orderMap = computed(() => {
  const m = new Map()
  wishes.value.forEach((id, i) => m.set(String(id), i + 1))
  return m
})
const isSel = (id) => orderMap.value.has(String(id))
const orderOf = (id) => orderMap.value.get(String(id))

// 已鎖定/已承租的車位（物業維護、雲端讀）：不可選。
onMounted(refreshLocked)
const isOccupied = (id) => lockedSeats.value.has(String(id))
// 重機戶（該戶登記有重機）：一台重機占相鄰兩個大位（點一格大位即可，配位自動帶鄰格）；不開放無障礙位（2026-10-29）。
const hasHeavy = computed(() => (sessionHousehold.value?.vehicles || []).some((v) => v.車種 === '重機'))
// 社宅戶：公益位專用（一般戶不可選公益位）。
const isSocial = computed(() => !!sessionHousehold.value?.社宅)
// 工作人員（辦法伍二（十二））：只配住戶配畢後之剩餘「一般位」——
// 公益位屬社宅戶專用、無障礙位留給行動不便者，兩者引擎都不會配給工作人員
// （distribute.js 工作人員輪的 ok＝!public && type!=='無障礙'）。
// 這裡一併擋住，否則他把這些位排進志願只是白填、抽完才發現全落空。
const isStaff = computed(() => !!sessionHousehold.value?.工作人員)
// ── 志願小位（辦法伍二（五）；2026-10-29 臨時管委會：登記時直接選定、依登記順序、限每戶第一輛一般機車）──
// 住戶在這裡點一格小位 →「選定並鎖定」→ 後端 claim-seat 以 locked_seat 主鍵互斥搶鎖，搶到即鎖、別人地圖上立刻不可選。
// 鎖下去後引擎視為已指派（preset）、不再抽；繳費由櫃台在維護頁標記。未繳費前可線上換格或放棄。
const firstCar = computed(() =>
  (sessionHousehold.value?.vehicles || []).find((v) => v.第幾輛 === 1 && v.車種 !== '自行車') || null,
)
const heldSmall = computed(() =>
  firstCar.value?.配位狀態 === '志願小位' && firstCar.value?.車位編號 ? String(firstCar.value.車位編號) : '',
)
const smallEligible = computed(
  () => !!householdId.value && !isStaff.value && !isSocial.value && firstCar.value?.車種 === '一般',
)
// 第一輛已有「不是自己線上選的」車位（櫃台指派／抽籤結果）→ 不給線上動。
const firstLockedElsewhere = computed(() => !!firstCar.value?.車位編號 && !heldSmall.value)
// 模式：登記時勾了志願小位、或已持有小位 → 預設進小位模式；否則排志願。可手動切換。
const smallMode = ref(false)
watch(
  [smallEligible, heldSmall],
  () => {
    smallMode.value = smallEligible.value && !firstLockedElsewhere.value && (!!heldSmall.value || !!firstCar.value?.志願小位)
  },
  { immediate: true },
)
const pendingSmall = ref('') // 小位模式下點選、尚未送出的格
const claiming = ref(false)
const claimMsg = ref('')
const claimErr = ref('')
const isHeld = (id) => !!heldSmall.value && String(id) === heldSmall.value
const smallSelectable = (s) => s.type === '小' && !s.public && (isHeld(s.id) || !isOccupied(s.id))
async function doClaim(op) {
  claimErr.value = ''
  claimMsg.value = ''
  const seat = op === 'claim' ? pendingSmall.value : ''
  if (op === 'claim' && !seat) return
  claiming.value = true
  try {
    const h = await claimSeatRemote({ op, 戶號: householdId.value, 車位編號: seat, 認證車號: sessionPlate.value })
    if (h) sessionHousehold.value = h
    pendingSmall.value = ''
    claimMsg.value = op === 'claim' ? `✓ 已為您鎖定小位 ${seat}，請至管理中心繳費確認。` : '已放棄小位，可改選其他格或排志願抽籤。'
  } catch (e) {
    claimErr.value = e?.message || '操作失敗，請稍後再試'
  } finally {
    claiming.value = false
    await refreshLocked() // 不論成敗都重抓：被搶走的格要立刻變灰
  }
}

const selectable = (s) => {
  if (smallMode.value) return smallSelectable(s)
  if (isOccupied(s.id)) return false
  if (isStaff.value) return !s.public && s.type !== '無障礙'
  if (isSocial.value) return !!s.public
  if (s.public) return false
  return s.type === '大' || s.type === '小' // 無障礙位限身障者（管理中心指派），任何人地圖上都不可選
}

const TYPE_LABEL = { 大: '大位', 小: '小位', 無障礙: '無障礙' }
function seatLabel(id) {
  const s = seats.find((x) => String(x.id) === String(id))
  return s ? `${TYPE_LABEL[s.type] || ''} ${id}` : id
}

function toggle(s) {
  if (!selectable(s)) return
  const id = String(s.id)
  if (smallMode.value) {
    // 小位模式：單選一格待確認；再點同一格取消。已持有的格點了沒事。
    if (isHeld(id)) return
    pendingSmall.value = pendingSmall.value === id ? '' : id
    claimMsg.value = ''
    claimErr.value = ''
    return
  }
  const i = wishes.value.indexOf(id)
  if (i >= 0) wishes.value.splice(i, 1)
  else wishes.value.push(id)
}
function removeAt(i) {
  wishes.value.splice(i, 1)
}
function clearAll() {
  wishes.value = []
}

const saved = ref(false)
const saving = ref(false)
const saveErr = ref('')
async function submit() {
  saveErr.value = ''
  if (!householdId.value) {
    saveErr.value = '請先登入再儲存志願'
    return
  }
  saving.value = true
  try {
    const h = await saveWishesRemote({
      戶號: householdId.value,
      車位志願: wishes.value,
      志願落選保底: computerPick.value,
      認證車號: sessionPlate.value,
    })
    if (h) sessionHousehold.value = h
    saved.value = true
    setTimeout(() => (saved.value = false), 2500)
  } catch (e) {
    saveErr.value = e?.message || '儲存失敗，請稍後再試'
  } finally {
    saving.value = false
  }
}

// 換登入身分時重置志願：登出→清空；換戶→載入該戶後端志願或重來；匿名試排→登入(且該戶無存檔)後接管。
watch(householdId, (newId, oldId) => {
  if (!newId) {
    wishes.value = [] // 登出 → 清空
    return
  }
  const saved = sessionHousehold.value?.車位志願?.map(String) || []
  if (saved.length) wishes.value = saved // 該戶後端已存 → 載入
  else if (oldId) wishes.value = [] // 由別戶切換來、且無存檔 → 重來
  // 匿名(oldId='')→登入且無存檔：保留目前試排
})

// 座位外觀：選中=紅、已售=深灰、公益=金、大=琥珀、小=紫、無障礙=灰。
function fill(s) {
  if (isHeld(s.id)) return '#059669' // 自己已鎖定的小位＝綠
  if (smallMode.value && pendingSmall.value === String(s.id)) return '#ef4444'
  if (!smallMode.value && isSel(s.id)) return '#ef4444'
  if (isOccupied(s.id)) return '#475569'
  if (smallMode.value && !(s.type === '小' && !s.public)) return 'rgba(203,213,225,.35)' // 小位模式：非小位淡化
  if (s.public) return 'rgba(234,179,8,.55)'
  if (s.type === '大') return 'rgba(245,158,11,.45)'
  if (s.type === '小') return 'rgba(139,92,246,.6)'
  return 'rgba(148,163,184,.4)'
}
function stroke(s) {
  if (isHeld(s.id)) return '#065f46'
  if (smallMode.value) return pendingSmall.value === String(s.id) ? '#b91c1c' : s.type === '小' && !s.public ? '#6d28d9' : '#cbd5e1'
  if (isSel(s.id)) return '#b91c1c'
  if (isOccupied(s.id)) return '#1e293b'
  if (s.public) return '#a16207'
  if (s.type === '大') return '#d97706'
  if (s.type === '小') return '#6d28d9'
  return '#64748b'
}
// 餵給 <SeatMap> 的每格外觀：未選顯示車位編號、選中顯示志願序號。
function decorate(s) {
  const sel = smallMode.value ? pendingSmall.value === String(s.id) || isHeld(s.id) : isSel(s.id)
  return {
    fill: fill(s),
    stroke: stroke(s),
    strokeWidth: s.public ? 2.4 : isHeld(s.id) ? 1.6 : 0.8,
    r: s.type === '小' ? 6 : 7,
    fontSize: s.type === '小' ? 5 : 5.5,
    fontWeight: sel ? 700 : 400,
    text: !smallMode.value && sel ? orderOf(s.id) : s.id,
    textFill: sel || isOccupied(s.id) ? '#e2e8f0' : '#0f172a',
    clickable: selectable(s),
  }
}
</script>

<template>
  <section class="mx-auto">
    <div class="flex items-baseline justify-between">
      <h1 class="text-2xl font-bold">選車位志願序</h1>
      <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">← 回我的登記</RouterLink>
    </div>

    <p class="mt-1 text-sm text-slate-500">
      在地圖上<b>依想要的順序</b>點選車位（點選順序＝志願 1、2、3…）；抽出順序號後，系統依序分發你「志願中仍剩的最高志願」。
      <span v-if="householdId">目前戶號 <b>{{ householdId }}</b>。</span>
      <span v-if="isStaff" class="text-amber-700">
        （社區工作人員：可選<b>一般大／小位</b>；公益位與無障礙位不開放。實際配位排在<b>全體住戶之後</b>，
        住戶尚未配完時暫緩。）
      </span>
      <span v-else class="text-amber-700">未登入：可先試排，<RouterLink to="/me" class="underline">登入</RouterLink>後才能儲存（志願需綁戶號才能進配位）。</span>
    </p>

    <div class="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <SeatMap :seats="seats" :decorate="decorate" @seat-click="toggle" />

      <!-- 志願清單 -->
      <aside class="rounded-lg border border-slate-200 bg-white p-4">
        <!-- 志願小位（限第一輛一般機車）：模式切換 + 選定/鎖定面板 -->
        <div v-if="smallEligible" class="mb-4 border-b border-slate-100 pb-4">
          <div class="flex items-center justify-between">
            <div class="font-semibold">志願小位 <span class="text-xs font-normal text-slate-400">免抽籤・先選先得</span></div>
            <button
              v-if="!firstLockedElsewhere"
              class="text-xs text-slate-500 hover:underline"
              @click="smallMode = !smallMode; pendingSmall = ''; claimMsg = ''; claimErr = ''"
            >
              {{ smallMode ? '改排志願（抽籤）→' : '← 我要選小位' }}
            </button>
          </div>

          <p v-if="firstLockedElsewhere" class="mt-2 text-xs text-slate-500">
            第 1 輛已有車位 <b class="font-mono">{{ firstCar.車位編號 }}</b>（{{ firstCar.配位狀態 }}），如需變更請洽管理中心。
          </p>
          <template v-else-if="smallMode">
            <div v-if="heldSmall" class="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✓ 您已鎖定小位 <b class="font-mono">{{ heldSmall }}</b>
              <span v-if="firstCar.已繳費">・已繳費確認</span>
              <span v-else>・{{ feeFor('一般') }} 元，請至管理中心繳費確認</span>
              <div v-if="!firstCar.已繳費" class="mt-1 text-xs text-emerald-700">繳費前可在地圖上點其他小位換格，或
                <button class="underline" :disabled="claiming" @click="doClaim('release')">放棄此小位</button>（改走抽籤）。</div>
            </div>
            <p v-else class="mt-2 text-xs text-slate-600">
              在地圖上點一格<b>小位</b>（紫色），按「選定並鎖定」即完成。鎖定後別人就選不到這格；請於登記期間至管理中心繳費確認。
            </p>
            <div v-if="pendingSmall" class="mt-2 flex items-center gap-2 text-sm">
              <span>{{ heldSmall ? '換到' : '選定' }}小位 <b class="font-mono">{{ pendingSmall }}</b></span>
              <button
                class="ml-auto rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                :disabled="claiming"
                @click="doClaim('claim')"
              >
                {{ claiming ? '鎖定中…' : '選定並鎖定' }}
              </button>
            </div>
            <p v-if="claimMsg" class="mt-2 text-sm text-emerald-700">{{ claimMsg }}</p>
            <p v-if="claimErr" class="mt-2 text-sm text-rose-600">{{ claimErr }}</p>
          </template>
          <p v-else class="mt-2 text-xs text-slate-500">
            <span v-if="heldSmall">您已鎖定小位 <b class="font-mono">{{ heldSmall }}</b>；下方志願序供第 2 輛起抽籤用。</span>
            <span v-else>想免抽籤直接選小位？點上方「我要選小位」。</span>
          </p>
        </div>

        <div class="flex items-center justify-between">
          <div class="font-semibold">車位志願序 <span class="text-slate-400">({{ wishes.length }})</span></div>
          <button v-if="wishes.length" class="text-xs text-slate-500 hover:underline" @click="clearAll">清除全部</button>
        </div>

        <ol v-if="wishes.length" class="mt-3 space-y-1.5">
          <li v-for="(id, i) in wishes" :key="id" class="flex items-center gap-2 text-sm">
            <span class="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white">{{ i + 1 }}</span>
            <span class="font-mono">{{ seatLabel(id) }}</span>
            <button class="ml-auto text-slate-400 hover:text-rose-600" @click="removeAt(i)">✕</button>
          </li>
        </ol>
        <p v-else class="mt-3 text-sm text-slate-400">尚未選擇。點地圖上的車位開始排志願。</p>

        <label class="mt-4 flex items-start gap-2 text-xs text-slate-600">
          <input v-model="computerPick" type="checkbox" class="mt-0.5 h-4 w-4" />
          <span><b>電腦選號</b>：志願全落選時，改由電腦自動配<b>本棟、靠電梯</b>的剩餘車位（可重現）；不勾＝進候補、等物業處理。</span>
        </label>

        <button
          v-if="householdId"
          class="mt-3 w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          :disabled="!wishes.length || saving"
          @click="submit"
        >
          {{ saving ? '儲存中…' : '儲存志願序' }}
        </button>
        <RouterLink
          v-else
          to="/me"
          class="mt-3 block w-full rounded bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-700"
        >
          登入後儲存
        </RouterLink>
        <p v-if="saved" class="mt-2 text-center text-sm text-emerald-600">✓ 已儲存到後端（戶號 {{ householdId }}）</p>
        <p v-if="saveErr" class="mt-2 text-center text-sm text-rose-600">{{ saveErr }}</p>

        <div class="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <div class="mb-1 font-medium text-slate-600">可選</div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <template v-if="isSocial">
              <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(234,179,8,.6);outline:1.5px solid #a16207"></span> 公益位（社宅自行安排，不開放登記）</span>
            </template>
            <template v-else>
              <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(245,158,11,.6)"></span> 大位</span>
              <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(139,92,246,.7)"></span> 小位</span>
            </template>
            <span><span class="inline-block h-2.5 w-2.5 rounded-full bg-rose-500"></span> 已選</span>
          </div>
          <p v-if="hasHeavy" class="mt-1 text-amber-700">重機占<b>相鄰兩個大位</b>：點一格大位即可，配位自動帶相鄰大位；一般機車全部配完後才配重機。</p>
          <div class="mb-1 mt-2 font-medium text-slate-600">不可選</div>
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            <span v-if="!isSocial"><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(234,179,8,.6);outline:1.5px solid #a16207"></span> 公益（社宅自行安排）</span>
            <span v-if="isStaff"><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(148,163,184,.45)"></span> 無障礙（保留給行動不便住戶）</span>
            <template v-else>
              <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(245,158,11,.6)"></span> 大位</span>
              <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(139,92,246,.7)"></span> 小位</span>
            </template>
            <span v-if="!isStaff"><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:rgba(148,163,184,.45)"></span> 無障礙（限身障者，管理中心指派）</span>
            <span><span class="inline-block h-2.5 w-2.5 rounded-full" style="background:#475569"></span> 已承租</span>
          </div>
        </div>
      </aside>
    </div>

    <p class="mt-3 text-xs text-slate-400">
      登入後「儲存志願序」會寫入後端（Supabase）；未登入僅本機試排。志願不限數量、多填越不易落空。
      志願小位（限第 1 輛一般機車）改為在本頁<b>直接選定一格並鎖定</b>，免抽籤；無障礙位由管理中心指派、免在此排。
    </p>
  </section>
</template>
