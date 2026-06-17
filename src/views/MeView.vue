<script setup>
import { ref, reactive } from 'vue'
import { login } from '../store/db.js'

const creds = reactive({ 戶號: '', 車號: '' })
const household = ref(null)
const error = ref('')
const loading = ref(false)

async function doLogin() {
  error.value = ''
  loading.value = true
  try {
    const h = await login(creds.戶號, creds.車號)
    if (!h) {
      error.value = '查無此登記，請確認戶號與車號（需為該戶登記過的任一台車）'
      return
    }
    household.value = h
  } catch {
    error.value = '登入失敗，請檢查網路後再試一次'
  } finally {
    loading.value = false
  }
}
function logout() {
  household.value = null
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

      <div>
        <div class="mb-2 text-sm font-medium text-slate-700">登記機車（{{ household.vehicles.length }} 台）</div>
        <div class="overflow-hidden rounded-lg border border-slate-200">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-3 py-2 text-left font-medium">第幾台</th>
                <th class="px-3 py-2 text-left font-medium">車號</th>
                <th class="px-3 py-2 text-left font-medium">車種</th>
                <th class="px-3 py-2 text-left font-medium">註記</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in household.vehicles" :key="v.車號" class="border-t border-slate-100">
                <td class="px-3 py-2">{{ v.第幾輛 }}</td>
                <td class="px-3 py-2 font-mono">{{ v.車號 }}</td>
                <td class="px-3 py-2">{{ v.車種 }}</td>
                <td class="px-3 py-2 text-slate-500">
                  <span v-if="v.身障">身障 </span><span v-if="v.志願小位">志願小位</span>
                  <span v-if="!v.身障 && !v.志願小位">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
        🎲 抽籤結果尚未公布。配位完成後，這裡會顯示您各台車分到的車位、應繳金額與簽約期限。
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
