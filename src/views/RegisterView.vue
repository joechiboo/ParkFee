<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { register, updateHousehold, RegistrationError } from '../store/db.js'
import { normalizeHousehold, isValidHousehold } from '../data/household.js'
import { normalizeTWPlate } from '../data/plate.js'
import { formatTWPhone, isValidTWPhone } from '../data/phone.js'
import { editTarget } from '../store/editTarget.js'
import { sessionHousehold, sessionPlate } from '../store/session.js'
import { KIND } from '../map/seat-id.js'

const router = useRouter()

// 自行車無車牌 → 車號由後端產生綁戶號的合成鍵（見 supabase/functions/_shared/vehicles.ts），
// 表單只收「特徵」當辨識用；身障／志願小位對自行車無意義，送出前一律清掉。
const BIKE = KIND.BIKE
const isBike = (v) => v.車種 === BIKE
const blankVehicle = (車種 = '一般') => ({ 車號: '', 車種, 身障: false, 志願小位: false, 特徵: '' })

const form = reactive({
  戶號: '',
  電話: '',
  社宅: false, // 社會住宅住戶：選位/配位限公益位（2026-08-16 決議）
  工作人員: false, // 社區工作人員：配位排全體住戶之後、免收費（辦法伍二（十二））
  vehicles: [blankVehicle()],
})
const error = ref('')
const done = ref(null) // 成功後的整戶資料
const isEdit = ref(false) // 由 MeView 帶資料進來編輯時為 true
const authPlate = ref('') // 登入時的車號，編輯送出時當擁有權證明

// 編輯模式：從 MeView 帶進來的 editTarget，或（直接點「登記」時）已登入的 sessionHousehold。
onMounted(() => {
  const h = editTarget.value || sessionHousehold.value
  if (!h) return // 未登入且非編輯 → 維持新登記空白表
  isEdit.value = true
  authPlate.value = h.認證車號 || sessionPlate.value || ''
  form.戶號 = h.戶號
  form.電話 = h.電話 || ''
  form.社宅 = !!h.社宅
  form.工作人員 = !!h.工作人員
  const vs = (h.vehicles || []).map((v) => ({
    // 自行車的車號是合成鍵、不給住戶看也不給改 → 留空，送出時後端重新產生。
    車號: v.車種 === BIKE ? '' : v.車號,
    車種: v.車種 === '重機' ? '重機' : v.車種 === BIKE ? BIKE : '一般',
    身障: !!v.身障,
    志願小位: !!v.志願小位,
    特徵: v.特徵 || '',
  }))
  form.vehicles = vs.length ? vs : [blankVehicle()]
  editTarget.value = null // 取用後清空，避免之後新登記誤入編輯模式
})

function addVehicle(車種 = '一般') {
  form.vehicles.push(blankVehicle(車種))
}
function removeVehicle(i) {
  if (form.vehicles.length > 1) form.vehicles.splice(i, 1)
}

function onHouseholdInput() {
  form.戶號 = normalizeHousehold(form.戶號)
}

const bikeOnly = computed(() => form.vehicles.length > 0 && form.vehicles.every(isBike))
// 自行車不填志願（辦法伍三(三)(六) 明寫抽車位號碼）→ 只有機車才要導去選位頁。
const doneHasMotor = computed(() => (done.value?.vehicles || []).some((v) => v.車種 !== BIKE))
const doneBikeCount = computed(() => (done.value?.vehicles || []).filter((v) => v.車種 === BIKE).length)
const doneMotorCount = computed(() => (done.value?.vehicles || []).filter((v) => v.車種 !== BIKE).length)

const submitting = ref(false)

async function submit() {
  error.value = ''
  form.戶號 = normalizeHousehold(form.戶號)
  if (!isValidHousehold(form.戶號)) {
    error.value = '戶號格式不對，請用「棟+樓-戶」，例：H3-6（店面 S1-6）'
    return
  }
  form.電話 = formatTWPhone(form.電話)
  if (form.電話 && !isValidTWPhone(form.電話)) {
    error.value = '電話格式不對，手機請填 09 開頭 10 碼（例 0986-642-519）'
    return
  }
  // 純自行車戶沒有車牌可當登入憑證 → 電話改為必填（後端 login 同此規則）。
  if (bikeOnly.value && !form.電話) {
    error.value = '只登記自行車時電話為必填 — 自行車沒有車牌，日後要靠電話讓物業查到你的登記'
    return
  }
  submitting.value = true
  try {
    // 自行車：車號交給後端產生合成鍵；身障／志願小位 無意義，清乾淨再送。
    const vehicles = form.vehicles.map((v) =>
      isBike(v)
        ? { 車種: BIKE, 特徵: v.特徵 }
        : { 車號: v.車號, 車種: v.車種, 身障: v.身障, 志願小位: v.志願小位 },
    )
    const payload = { 戶號: form.戶號, 電話: form.電話, 社宅: form.社宅, 工作人員: form.工作人員, vehicles }
    done.value = isEdit.value
      ? await updateHousehold({ ...payload, 認證車號: authPlate.value })
      : await register(payload)
    sessionHousehold.value = done.value
    sessionPlate.value = done.value?.vehicles?.[0]?.車號 || authPlate.value
  } catch (e) {
    if (e instanceof RegistrationError) error.value = e.message
    else error.value = '送出失敗，請檢查網路後再試一次'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <h1 class="text-2xl font-bold">{{ isEdit ? '編輯登記' : '車位登記（機車／自行車）' }}</h1>

    <!-- 完成畫面 -->
    <div v-if="done" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <div class="font-semibold text-emerald-900">✓ {{ isEdit ? '更新完成' : '登記完成' }}</div>
      <p class="mt-1 text-sm text-emerald-800">
        戶號 <b>{{ done.戶號 }}</b> 已登記
        <span v-if="doneMotorCount">{{ doneMotorCount }} 台機車</span>
        <span v-if="doneMotorCount && doneBikeCount">、</span>
        <span v-if="doneBikeCount">{{ doneBikeCount }} 台自行車</span>。<span v-if="done.社宅">（社會住宅住戶：限選公益位）</span><span v-if="done.工作人員">（社區工作人員：住戶配畢後之剩餘位，免收費用）</span>
      </p>
      <p v-if="doneHasMotor" class="mt-2 text-sm text-emerald-800">
        之後可用 <b>戶號 ＋ 任一車號</b> 登入查看登記內容與抽籤結果。
      </p>
      <p v-else class="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
        <b>只登記自行車者無法自行上線查詢</b> — 登入需要車號，自行車沒有車牌。
        要查詢或修改請洽管理中心臨櫃辦理，抽籤結果也會另行公告。
      </p>
      <ul class="mt-2 space-y-1 text-sm text-emerald-900">
        <li v-for="v in done.vehicles" :key="v.車號" class="font-mono">
          <template v-if="v.車種 === BIKE">
            自行車 第 {{ v.第幾輛 }} 台<span v-if="v.特徵"> · {{ v.特徵 }}</span>
          </template>
          <template v-else>
            第 {{ v.第幾輛 }} 台 · {{ v.車號 }} · {{ v.車種 }}
            <span v-if="v.身障"> · 身障</span><span v-if="v.志願小位"> · 志願小位</span>
          </template>
        </li>
      </ul>
      <p v-if="doneHasMotor" class="mt-3 rounded border border-emerald-300 bg-white/60 p-2 text-sm text-emerald-900">
        <b>下一步：排「車位志願序」</b> — 抽籤會依你的志願由高到低分發，建議至少排幾個。<span v-if="doneBikeCount">（自行車不用排志願，12/1 直接抽車位號碼。）</span>
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <RouterLink
          v-if="doneHasMotor"
          to="/select"
          class="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
        >
          🗺️ 下一步：選車位志願序
        </RouterLink>
        <button
          class="rounded border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
          @click="router.push('/me')"
        >
          查看我的登記
        </button>
      </div>
    </div>

    <!-- 表單 -->
    <form v-else class="mt-4 space-y-5" @submit.prevent="submit">
      <p class="text-sm text-slate-500">
        一戶限登記一次，請一次填齊所有機車與自行車。證件查驗於<b>繳費簽約時</b>辦理，出示<b>行照或身分證</b>擇一即可。本系統不蒐集身分證號。
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">戶號 *</span>
          <input v-model="form.戶號" @input="onHouseholdInput" :disabled="isEdit" type="text"
            :placeholder="form.工作人員 ? '例：員工-陳大明' : '例：H3-6（店面 S1-6）'"
            style="text-transform:uppercase"
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500" />
          <span v-if="isEdit" class="mt-1 block text-xs text-slate-500">編輯模式：戶號不可修改</span>
          <span v-else-if="form.戶號 && !isValidHousehold(form.戶號)" class="mt-1 block text-xs text-red-600">
            <template v-if="form.工作人員">工作人員請填「員工-姓名」，例：員工-陳大明</template>
            <template v-else>格式：棟(A–H)+樓(1–15)-戶，例 H3-6；店面 S1-6</template>
          </span>
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">聯絡電話<span v-if="bikeOnly"> *</span></span>
          <input v-model="form.電話" @blur="form.電話 = formatTWPhone(form.電話)" type="tel" placeholder="0912-345-678"
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none" />
          <span v-if="form.電話 && !isValidTWPhone(form.電話)" class="mt-1 block text-xs text-red-600">手機請填 09 開頭 10 碼（例 0986-642-519）</span>
        </label>
      </div>

      <label class="flex items-start gap-2 text-sm text-slate-700">
        <input v-model="form.社宅" type="checkbox" class="mt-0.5 h-4 w-4" />
        <span><b>社會住宅住戶</b> — 車位為公益位專區（選位時僅能選公益位；由物業核對身分）</span>
      </label>

      <label class="flex items-start gap-2 text-sm text-slate-700">
        <input v-model="form.工作人員" type="checkbox" class="mt-0.5 h-4 w-4" />
        <span>
          <b>社區工作人員</b> — 車位為住戶配畢後的剩餘位，住戶需要時須讓出
          <span class="text-slate-500">（由物業核對身分）</span>
        </span>
      </label>

      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm font-medium text-slate-700">車輛（機車第 1 台為保障一位的主車）</span>
          <div class="flex gap-2">
            <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="addVehicle()">
              + 機車
            </button>
            <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="addVehicle(BIKE)">
              + 自行車
            </button>
          </div>
        </div>

        <div v-for="(v, i) in form.vehicles" :key="i" class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-500">第 {{ i + 1 }} 台</span>
            <button v-if="form.vehicles.length > 1" type="button" class="text-xs text-rose-600 hover:underline" @click="removeVehicle(i)">
              移除
            </button>
          </div>
          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            <!-- 自行車無車牌 → 車號欄換成「特徵」，車號由系統綁戶號產生 -->
            <label v-if="isBike(v)" class="block">
              <span class="text-xs text-slate-600">特徵（方便辨識）</span>
              <input v-model="v.特徵" type="text" maxlength="50" placeholder="例：黑色捷安特、粉紅色淑女車"
                class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none" />
            </label>
            <label v-else class="block">
              <span class="text-xs text-slate-600">車號 *</span>
              <input v-model="v.車號" @input="v.車號 = v.車號.toUpperCase()" @blur="v.車號 = normalizeTWPlate(v.車號)" type="text" placeholder="ABC-123"
                class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm uppercase focus:border-slate-500 focus:outline-none" />
            </label>
            <label class="block">
              <span class="text-xs text-slate-600">車種</span>
              <select v-model="v.車種" class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none">
                <option value="一般">一般（≤250CC）</option>
                <option value="重機">重機（250CC↑，佔雙位）</option>
                <option :value="BIKE">自行車（無車牌，免費）</option>
              </select>
            </label>
          </div>
          <p v-if="isBike(v)" class="mt-2 text-xs text-slate-500">
            自行車不用填車號、也不用排志願序 — 12/1 直接抽車位號碼。
          </p>
          <div v-else class="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input v-model="v.身障" type="checkbox" class="h-4 w-4" /> 身障（無障礙優先）
            </label>
            <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input v-model="v.志願小位" type="checkbox" class="h-4 w-4" /> 志願小位（免抽依序選）
            </label>
          </div>
        </div>

        <p v-if="bikeOnly" class="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <b>只登記自行車：電話必填。</b>自行車沒有車牌，日後無法自行上線查詢或修改（登入要用車號），
          需要異動時請洽管理中心臨櫃辦理。
        </p>
      </div>

      <p v-if="error" class="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

      <div class="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <button type="submit" :disabled="submitting" class="rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {{ submitting ? '處理中…' : (isEdit ? '更新登記' : '送出登記') }}
        </button>
        <RouterLink to="/me" class="text-center text-sm text-slate-500 hover:underline sm:text-left">已登記過？登入查看 →</RouterLink>
      </div>
    </form>
  </section>
</template>
