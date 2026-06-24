<script setup>
import { computed } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { sessionHousehold, clearSession } from './store/session.js'
import { isAdmin } from './store/roles.js'

const router = useRouter()
const route = useRoute()
// 選位頁是地圖頁，給更寬版面；其餘頁維持窄版易讀。
const shellMax = computed(() => (route.name === 'select' ? 'max-w-[1600px]' : 'max-w-5xl'))

function logout() {
  clearSession()
  router.push('/')
}

// 主導覽（管委會作業）；登入 (/me) 另放右側。配位＝公開範例 demo（鄰居可玩）。
const visibleNav = [
  { to: '/register', label: '登記' },
  { to: '/allocate', label: '配位' },
  { to: '/result', label: '結果' },
  { to: '/patrol', label: '巡邏稽核' },
]

// 工程師專區入口：開發模式 + 管理員才顯示（含真實名冊匯入；正式 build 整個 tree-shake 掉）。
const isDev = import.meta.env.DEV
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex items-center gap-3 px-4 py-3 sm:gap-6" :class="shellMax">
        <RouterLink to="/" class="shrink-0 text-lg font-bold tracking-tight text-slate-900">
          ParkFee
        </RouterLink>
        <nav class="-mx-1 flex flex-nowrap gap-1 overflow-x-auto px-1 text-sm sm:flex-wrap">
          <RouterLink
            v-for="item in visibleNav"
            :key="item.to"
            :to="item.to"
            class="shrink-0 rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100"
            active-class="bg-slate-900 text-white hover:bg-slate-900"
          >
            {{ item.label }}
          </RouterLink>
          <RouterLink
            v-if="isAdmin(sessionHousehold)"
            to="/seat-admin"
            class="shrink-0 rounded border border-dashed border-emerald-400 px-3 py-1.5 text-emerald-700 hover:bg-emerald-50"
            active-class="bg-emerald-600 text-white hover:bg-emerald-600"
          >
            🔧 管理
          </RouterLink>
          <RouterLink
            v-if="isDev && isAdmin(sessionHousehold)"
            to="/dev"
            class="shrink-0 rounded border border-dashed border-amber-400 px-3 py-1.5 text-amber-700 hover:bg-amber-50"
            active-class="bg-amber-500 text-white hover:bg-amber-500"
          >
            🛠 dev
          </RouterLink>
        </nav>
        <div v-if="sessionHousehold" class="ml-auto flex shrink-0 items-center gap-2">
          <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">{{ sessionHousehold.戶號 }}</RouterLink>
          <button
            type="button"
            class="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            @click="logout"
          >
            登出
          </button>
        </div>
        <RouterLink
          v-else
          to="/me"
          class="ml-auto shrink-0 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          active-class="bg-slate-900 text-white hover:bg-slate-900"
        >
          登入
        </RouterLink>
      </div>
    </header>

    <main class="mx-auto px-4 py-6" :class="shellMax">
      <RouterView />
    </main>

    <footer class="mx-auto px-4 py-6 text-xs text-slate-400" :class="shellMax">
      樂菲莊園機車車位管理工具
    </footer>
  </div>
</template>
