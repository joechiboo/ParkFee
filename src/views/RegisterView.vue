<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { register, updateHousehold, RegistrationError } from '../store/db.js'
import { normalizeHousehold, isValidHousehold } from '../data/household.js'
import { normalizeTWPlate } from '../data/plate.js'
import { formatTWPhone, isValidTWPhone } from '../data/phone.js'
import { editTarget } from '../store/editTarget.js'

const router = useRouter()

const form = reactive({
  戶號: '',
  電話: '',
  vehicles: [{ 車號: '', 車種: '一般', 身障: false, 志願小位: false }],
})
const error = ref('')
const done = ref(null) // 成功後的整戶資料
const isEdit = ref(false) // 由 MeView 帶資料進來編輯時為 true

// 編輯模式：載入 MeView 傳來的整戶資料、預填表單、鎖戶號
onMounted(() => {
  const h = editTarget.value
  if (!h) return
  isEdit.value = true
  form.戶號 = h.戶號
  form.電話 = h.電話 || ''
  const vs = (h.vehicles || []).map((v) => ({
    車號: v.車號,
    車種: v.車種 === '重機' ? '重機' : '一般',
    身障: !!v.身障,
    志願小位: !!v.志願小位,
  }))
  form.vehicles = vs.length ? vs : [{ 車號: '', 車種: '一般', 身障: false, 志願小位: false }]
  editTarget.value = null // 取用後清空，避免之後新登記誤入編輯模式
})

function addVehicle() {
  form.vehicles.push({ 車號: '', 車種: '一般', 身障: false, 志願小位: false })
}
function removeVehicle(i) {
  if (form.vehicles.length > 1) form.vehicles.splice(i, 1)
}

function onHouseholdInput() {
  form.戶號 = normalizeHousehold(form.戶號)
}

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
  submitting.value = true
  try {
    const payload = { 戶號: form.戶號, 電話: form.電話, vehicles: form.vehicles }
    done.value = isEdit.value ? await updateHousehold(payload) : await register(payload)
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
    <h1 class="text-2xl font-bold">{{ isEdit ? '編輯登記' : '機車車位登記' }}</h1>

    <!-- 完成畫面 -->
    <div v-if="done" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <div class="font-semibold text-emerald-900">✓ {{ isEdit ? '更新完成' : '登記完成' }}</div>
      <p class="mt-1 text-sm text-emerald-800">
        戶號 <b>{{ done.戶號 }}</b> 已登記 {{ done.vehicles.length }} 台機車。
      </p>
      <p class="mt-2 text-sm text-emerald-800">
        之後可用 <b>戶號 ＋ 任一車號</b> 登入查看登記內容與抽籤結果。
      </p>
      <ul class="mt-2 space-y-1 text-sm text-emerald-900">
        <li v-for="v in done.vehicles" :key="v.車號" class="font-mono">
          第 {{ v.第幾輛 }} 台 · {{ v.車號 }} · {{ v.車種 }}
          <span v-if="v.身障"> · 身障</span><span v-if="v.志願小位"> · 志願小位</span>
        </li>
      </ul>
      <div class="mt-4 flex gap-2">
        <button class="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800" @click="router.push('/me')">
          前往登入
        </button>
      </div>
    </div>

    <!-- 表單 -->
    <form v-else class="mt-4 space-y-5" @submit.prevent="submit">
      <p class="text-sm text-slate-500">
        一戶限登記一次，請一次填齊所有機車。登記時請出示行車執照供查驗。本系統不蒐集身分證號。
      </p>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-medium text-slate-700">戶號 *</span>
          <input v-model="form.戶號" @input="onHouseholdInput" :disabled="isEdit" type="text" placeholder="例：H3-6（店面 S1-6）"
            style="text-transform:uppercase"
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500" />
          <span v-if="isEdit" class="mt-1 block text-xs text-slate-500">編輯模式：戶號不可修改</span>
          <span v-else-if="form.戶號 && !isValidHousehold(form.戶號)" class="mt-1 block text-xs text-red-600">格式：棟(A–H)+樓(1–15)-戶，例 H3-6；店面 S1-6</span>
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">聯絡電話</span>
          <input v-model="form.電話" @blur="form.電話 = formatTWPhone(form.電話)" type="tel" placeholder="0912-345-678"
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none" />
          <span v-if="form.電話 && !isValidTWPhone(form.電話)" class="mt-1 block text-xs text-red-600">手機請填 09 開頭 10 碼（例 0986-642-519）</span>
        </label>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-slate-700">機車（第 1 台為保障一位的主車）</span>
          <button type="button" class="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" @click="addVehicle">
            + 加一台
          </button>
        </div>

        <div v-for="(v, i) in form.vehicles" :key="i" class="rounded-lg border border-slate-200 bg-white p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-slate-500">第 {{ i + 1 }} 台</span>
            <button v-if="form.vehicles.length > 1" type="button" class="text-xs text-rose-600 hover:underline" @click="removeVehicle(i)">
              移除
            </button>
          </div>
          <div class="mt-2 grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="text-xs text-slate-600">車號 *</span>
              <input v-model="v.車號" @input="v.車號 = v.車號.toUpperCase()" @blur="v.車號 = normalizeTWPlate(v.車號)" type="text" placeholder="ABC-123"
                class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm uppercase focus:border-slate-500 focus:outline-none" />
            </label>
            <label class="block">
              <span class="text-xs text-slate-600">車種</span>
              <select v-model="v.車種" class="mt-1 w-full rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none">
                <option value="一般">一般（≤250CC）</option>
                <option value="重機">重機（250CC↑，佔雙位）</option>
              </select>
            </label>
          </div>
          <div class="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input v-model="v.身障" type="checkbox" class="h-4 w-4" /> 身障（無障礙優先）
            </label>
            <label class="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input v-model="v.志願小位" type="checkbox" class="h-4 w-4" /> 志願小位（免抽依序選）
            </label>
          </div>
        </div>
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
