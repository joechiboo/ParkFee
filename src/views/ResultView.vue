<script setup>
// 結果確認頁（住戶）：登入後看自己每台車的「配位 + 繳費」狀態（涵蓋全流程，含已登記未繳費）。
//   狀態：已登記·待配位 → 待繳費（中籤/指派、限期）→ 已繳費確認；未中者列候補。
//   登入與 MeView 共用（sessionHousehold）；未登入導去 /me。流程說明常駐，幫助理解整體。
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { sessionHousehold, refreshHousehold } from '../store/session.js'
import { feeFor } from '../data/fee.js'
import { vehicleResultStatus } from '../data/vehicleStatus.js'
import { displaySeatIds } from '../map/seat-id.js'
import { displayVehicleLabel } from '../data/vehicle.js'

const household = sessionHousehold // 跨頁共用登入狀態
onMounted(refreshHousehold) // 進頁時重抓最新戶資料（後台指派/繳費後免重新登入）
const vehicles = computed(() => household.value?.vehicles || [])

// 狀態鍵（純函式，見 data/vehicleStatus.js）→ 顯示用 label/底色。
const CLS = {
  paid: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  waitlist: 'bg-rose-50 text-rose-600',
  registered: 'bg-slate-100 text-slate-500',
}
function labelOf(key, v) {
  if (key === 'paid') return '✅ 已繳費確認'
  if (key === 'pending') return '⚠️ 待繳費'
  if (key === 'waitlist') return '❌ ' + v.配位狀態
  return '🔄 已登記·待配位'
}
const rows = computed(() =>
  vehicles.value.map((v) => {
    const key = vehicleResultStatus(v)
    return { v, s: { key, label: labelOf(key, v), cls: CLS[key] } }
  }),
)
const hasPending = computed(() => rows.value.some((r) => r.s.key === 'pending'))
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <h1 class="text-2xl font-bold">車位結果確認</h1>
    <p class="mt-1 text-sm text-slate-600">您各台車的配位與繳費狀態。繳費完成（綠色）即為確認車位。</p>

    <!-- 未登入 -->
    <div v-if="!household" class="mt-5 rounded-lg border border-slate-200 bg-white p-6 text-center">
      <p class="text-slate-600">請先登入以查詢自己的車位。</p>
      <RouterLink
        to="/me"
        class="mt-3 inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        前往「我的登記」登入
      </RouterLink>
    </div>

    <template v-else>
      <!-- 全車狀態表（含已登記未繳費） -->
      <div class="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table v-if="rows.length" class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500">
            <tr>
              <th class="px-3 py-2 text-left">車號</th>
              <th class="px-3 py-2 text-left">車種</th>
              <th class="px-3 py-2 text-left">車位</th>
              <th class="px-3 py-2 text-left">狀態</th>
              <th class="px-3 py-2 text-left">應繳 / 期限</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="{ v, s } in rows" :key="v.車號" class="border-t border-slate-100">
              <td class="px-3 py-2 font-mono">{{ displayVehicleLabel(v) }}</td>
              <td class="px-3 py-2">{{ v.車種 }}</td>
              <td class="px-3 py-2 font-mono">
                {{ displaySeatIds(v.車位編號) || '—' }}<span v-if="v.車位類型" class="text-xs text-slate-400">（{{ v.車位類型 }}）</span>
              </td>
              <td class="px-3 py-2">
                <span class="inline-block rounded px-2 py-0.5 text-xs font-medium" :class="s.cls">{{ s.label }}</span>
              </td>
              <td class="px-3 py-2 text-slate-600">
                <template v-if="s.key === 'paid'">已繳清</template>
                <template v-else-if="s.key === 'pending'">{{ feeFor(v.車種) }} 元<span v-if="v.簽約期限"> · {{ v.簽約期限 }}</span></template>
                <template v-else>—</template>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="px-3 py-6 text-center text-sm text-slate-500">查無登記車輛。</p>
      </div>

      <!-- 待繳費提醒 -->
      <p v-if="hasPending" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        ⚠️ 您有車位<b>待繳費</b>：請於簽約期限內到管理中心完成簽約繳費，逾期視同放棄並由候補遞補。
      </p>
    </template>

    <!-- 流程說明（常駐，幫助理解整個流程；保留原結果說明內容） -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      <h2 class="font-semibold text-slate-700">📋 結果與繳費流程說明</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5">
        <li><b>配位結果</b>含：車號 / 車位編號 / 類型 / 應繳金額 / 簽約期限 / 狀態。</li>
        <li><b>費用</b>：一般機車位 1,200 元/年、重機位 3,600 元/年。</li>
        <li>
          <b>狀態流程</b>：
          <span class="text-slate-500">已登記·待配位</span> →
          <span class="text-amber-700">待繳費</span>（中籤或指派，須限期繳費）→
          <span class="text-emerald-700">已繳費確認</span>；未中者列
          <span class="text-rose-600">候補</span>，前位放棄即依序遞補。
        </li>
        <li>志願小位／無障礙在物業指派當下即完成繳費；中籤大位需於簽約期限內到管理中心繳費。</li>
      </ul>
    </div>

    <p v-if="household" class="mt-4 text-xs text-slate-400">
      要看完整登記內容與編輯，請到
      <RouterLink to="/me" class="underline hover:text-slate-600">我的登記</RouterLink>。
    </p>
  </section>
</template>
