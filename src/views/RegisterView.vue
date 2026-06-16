<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { register, RegistrationError } from '../store/db.js'
import { normalizeHousehold, isValidHousehold } from '../data/household.js'

const router = useRouter()

const form = reactive({
  戶號: '',
  電話: '',
  vehicles: [{ 車號: '', 車種: '一般', 身障: false, 志願小位: false }],
})
const error = ref('')
const done = ref(null) // 成功後的整戶資料

function addVehicle() {
  form.vehicles.push({ 車號: '', 車種: '一般', 身障: false, 志願小位: false })
}
function removeVehicle(i) {
  if (form.vehicles.length > 1) form.vehicles.splice(i, 1)
}

function onHouseholdInput() {
  form.戶號 = normalizeHousehold(form.戶號)
}

function submit() {
  error.value = ''
  form.戶號 = normalizeHousehold(form.戶號)
  if (!isValidHousehold(form.戶號)) {
    error.value = '戶號格式不對，請用「棟+樓-戶」，例：H3-6（店面 S1-6）'
    return
  }
  try {
    done.value = register({ 戶號: form.戶號, 電話: form.電話, vehicles: form.vehicles })
  } catch (e) {
    if (e instanceof RegistrationError) error.value = e.message
    else throw e
  }
}
</script>

<template>
  <section class="max-w-2xl">
    <h1 class="text-2xl font-bold">機車車位登記</h1>

    <!-- 完成畫面 -->
    <div v-if="done" class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
      <div class="font-semibold text-emerald-900">✓ 登記完成</div>
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
          <input v-model="form.戶號" @input="onHouseholdInput" type="text" placeholder="例：H3-6（店面 S1-6）"
            style="text-transform:uppercase"
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
          <span v-if="form.戶號 && !isValidHousehold(form.戶號)" class="mt-1 block text-xs text-red-600">格式：棟(A–H)+樓(1–15)-戶，例 H3-6；店面 S1-6</span>
        </label>
        <label class="block">
          <span class="text-sm font-medium text-slate-700">聯絡電話</span>
          <input v-model="form.電話" type="tel" placeholder="0912-345-678"
            class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
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
              <input v-model="v.車號" type="text" placeholder="ABC-123"
                class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none" />
            </label>
            <label class="block">
              <span class="text-xs text-slate-600">車種</span>
              <select v-model="v.車種" class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
                <option value="一般">一般（≤250CC）</option>
                <option value="重機">重機（250CC↑，佔雙位）</option>
              </select>
            </label>
          </div>
          <div class="mt-2 flex gap-5">
            <label class="flex items-center gap-1.5 text-sm text-slate-700">
              <input v-model="v.身障" type="checkbox" /> 身障（無障礙優先）
            </label>
            <label class="flex items-center gap-1.5 text-sm text-slate-700">
              <input v-model="v.志願小位" type="checkbox" /> 志願小位（免抽依序選）
            </label>
          </div>
        </div>
      </div>

      <p v-if="error" class="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>

      <div class="flex items-center gap-3">
        <button type="submit" class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          送出登記
        </button>
        <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">已登記過？登入查看 →</RouterLink>
      </div>
    </form>
  </section>
</template>
