<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { login } from '../store/db.js'
import { editTarget } from '../store/editTarget.js'
import { sessionHousehold, sessionPlate, clearSession, refreshHousehold } from '../store/session.js'
import { tryAdminLogin, isAdmin } from '../store/roles.js'
import { feeFor } from '../data/fee.js'

// 抽籤結果是否已公布（任一車有配位狀態）。
const hasResult = computed(() => (household.value?.vehicles || []).some((v) => v.配位狀態))

const creds = reactive({ 戶號: '', 車號: '' })
const household = sessionHousehold // 登入狀態跨頁保留
const error = ref('')
const loading = ref(false)
const router = useRouter()

onMounted(refreshHousehold) // 已登入時重抓最新戶資料（後台指派/繳費/發佈後免重新登入）

function startEdit() {
  // 帶上登入用的車號作為擁有權證明，server 端編輯時會驗證
  editTarget.value = { ...household.value, 認證車號: sessionPlate.value }
  router.push('/register')
}

async function doLogin() {
  error.value = ''
  // 管理員特例（前端，免後端）：戶號 admin ＋ 車號 樂菲莊園
  const admin = tryAdminLogin(creds.戶號, creds.車號)
  if (admin) {
    household.value = admin
    sessionPlate.value = creds.車號
    return
  }
  loading.value = true
  try {
    const h = await login(creds.戶號, creds.車號)
    if (!h) {
      error.value = '查無此登記，請確認戶號與車號（需為該戶登記過的任一台車）'
      return
    }
    household.value = h
    sessionPlate.value = creds.車號
  } catch {
    error.value = '登入失敗，請檢查網路後再試一次'
  } finally {
    loading.value = false
  }
}
function logout() {
  clearSession()
  creds.戶號 = ''
  creds.車號 = ''
}
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <h1 class="text-2xl font-bold">我的登記 / 抽籤結果</h1>

    <!-- 已登入 -->
    <div v-if="household" class="mt-4 space-y-4">
      <div class="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <div class="text-sm text-slate-500">戶號</div>
          <div class="text-lg font-semibold">{{ household.戶號 }}</div>
          <div v-if="household.電話" class="text-sm text-slate-500">{{ household.電話 }}</div>
        </div>
        <button class="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" @click="logout">登出</button>
      </div>

      <!-- 管理員（物業） -->
      <div v-if="isAdmin(household)" class="space-y-3 rounded-lg border-2 border-dashed border-emerald-400 bg-emerald-50 p-4">
        <div class="font-semibold text-emerald-900">🔧 管理員（物業）</div>
        <div class="flex flex-wrap gap-3">
          <RouterLink to="/seat-admin" class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">🔒 車位鎖定維護</RouterLink>
          <RouterLink to="/allocate" class="rounded border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100">🎲 抽籤配位</RouterLink>
        </div>
      </div>

      <div v-if="!isAdmin(household)">
        <div class="mb-2 text-sm font-medium text-slate-700">登記機車（{{ household.vehicles.length }} 台）</div>
        <div class="overflow-hidden rounded-lg border border-slate-200">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-3 py-2 text-left font-medium">第幾台</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">車種</th>
                <th class="px-3 py-2 text-left font-medium">車位</th>
                <th class="px-3 py-2 text-left font-medium">結果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in household.vehicles" :key="v.車號" class="border-t border-slate-100">
                <td class="px-3 py-2">{{ v.第幾輛 }}</td>
                <td class="px-3 py-2 font-mono">{{ v.車號 }}</td>
                <td class="px-3 py-2">
                  {{ v.車種 }}
                  <span v-if="v.身障" class="text-xs text-slate-400">·身障</span>
                  <span v-if="v.志願小位" class="text-xs text-slate-400">·志願小位</span>
                </td>
                <td class="px-3 py-2 font-mono">{{ v.車位編號 || '—' }}<span v-if="v.車位類型" class="text-xs text-slate-400">（{{ v.車位類型 }}）</span></td>
                <td class="px-3 py-2 text-sm">
                  <template v-if="v.配位狀態">
                    <span :class="v.配位狀態 === '分配' ? 'font-medium text-emerald-700' : 'text-rose-600'">{{ v.配位狀態 }}</span>
                    <span v-if="v.配位狀態 === '分配'" class="text-slate-500">· {{ feeFor(v.車種) }} 元 · 簽約 {{ v.簽約期限 || '公告後5日內' }}</span>
                  </template>
                  <span v-else class="text-slate-400">未公布</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="!isAdmin(household)" class="flex flex-wrap gap-3">
        <button class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700" @click="startEdit">
          ✏ 編輯登記（新增 / 移除機車）
        </button>
        <RouterLink to="/select" class="rounded border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
          🗺️ 選車位志願序
        </RouterLink>
      </div>

      <div v-if="!isAdmin(household) && !hasResult" class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        🎲 抽籤結果尚未公布。配位完成後，這裡會顯示您各台車分到的車位、應繳金額與簽約期限。
      </div>
      <div v-else-if="!isAdmin(household)" class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        ✅ 抽籤結果已公布（見上表「車位／結果」）。<b>分配</b>者請於簽約期限內到管理中心簽約繳費；<b>未中</b>者列候補，前位放棄即依序遞補。
      </div>
    </div>

    <!-- 未登入：登入表單 -->
    <form v-else class="mt-4 max-w-sm space-y-4" @submit.prevent="doLogin">
      <p class="text-sm text-slate-500">用 <b>戶號 ＋ 任一已登記車號</b> 登入。</p>
      <label class="block">
        <span class="text-sm font-medium text-slate-700">戶號</span>
        <input v-model="creds.戶號" type="text" placeholder="H3-6（店面 S1-6）"
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-slate-700">車號</span>
        <input v-model="creds.車號" type="text" placeholder="ABC-123"
          class="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase focus:border-slate-500 focus:outline-none" />
      </label>
      <p v-if="error" class="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ error }}</p>
      <div class="flex items-center gap-3">
        <button type="submit" :disabled="loading" class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{{ loading ? '登入中…' : '登入' }}</button>
        <RouterLink to="/register" class="text-sm text-slate-500 hover:underline">還沒登記？前往登記 →</RouterLink>
      </div>
    </form>
  </section>
</template>
