<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter, useRoute } from 'vue-router'
import { sessionHousehold, clearSession } from './store/session.js'
import { isAdmin } from './store/roles.js'

const router = useRouter()
const route = useRoute()
// 選位頁是地圖頁，給更寬版面；其餘頁維持窄版易讀。
const shellMax = computed(() => (route.name === 'select' ? 'max-w-[1600px]' : 'max-w-5xl'))

// 手機漢堡選單開關；換頁自動收起。
const menuOpen = ref(false)
watch(() => route.fullPath, () => (menuOpen.value = false))

function logout() {
  clearSession()
  menuOpen.value = false
  router.push('/')
}

// 主導覽（管委會作業）；登入 (/me) 另放右側。配位＝公開範例 demo（鄰居可玩）。
// adminOnly：限管理員（巡邏讀指派個資）。
const nav = [
  { to: '/register', label: '登記' },
  { to: '/select', label: '選位' },
  { to: '/allocate', label: '配位' },
  { to: '/result', label: '結果' },
  { to: '/patrol', label: '巡邏稽核', adminOnly: true },
]
const visibleNav = computed(() => nav.filter((i) => !i.adminOnly || isAdmin(sessionHousehold.value)))

// 桌機橫列與手機直式選單共用同一份連結（含管理員專屬），避免兩處各寫一遍。
const menuItems = computed(() => {
  const items = visibleNav.value.map((i) => ({ to: i.to, label: i.label, cls: 'plain' }))
  if (isAdmin(sessionHousehold.value)) {
    items.push({ to: '/seat-admin', label: '🔧 管理', cls: 'admin' })
    items.push({ to: '/dev', label: '🛠 進階', cls: 'dev' })
  }
  return items
})
// mobile=true → 全寬大按鈕（好點）；false → 桌機小 pill。
function linkClass(cls, mobile) {
  const size = mobile ? 'block rounded-lg px-4 py-3 text-base' : 'shrink-0 rounded px-3 py-1.5 text-sm'
  if (cls === 'admin') return `${size} border border-dashed border-emerald-400 text-emerald-700 hover:bg-emerald-50`
  if (cls === 'dev') return `${size} border border-dashed border-amber-400 text-amber-700 hover:bg-amber-50`
  return `${size} text-slate-600 hover:bg-slate-100`
}
function activeClass(cls) {
  if (cls === 'admin') return 'bg-emerald-600 text-white hover:bg-emerald-600'
  if (cls === 'dev') return 'bg-amber-500 text-white hover:bg-amber-500'
  return 'bg-slate-900 text-white hover:bg-slate-900'
}

// 版號＝建置（發佈）時間，vite.config 的 define 注入；藏頁尾方便確認線上版本。
// eslint-disable-next-line no-undef
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Vdev'
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex items-center gap-3 px-4 py-3 sm:gap-6" :class="shellMax">
        <RouterLink to="/" class="shrink-0 text-lg font-bold tracking-tight text-slate-900">
          ParkFee
        </RouterLink>

        <!-- 桌機：橫列導覽 -->
        <nav class="ml-1 hidden flex-wrap gap-1 sm:flex">
          <RouterLink
            v-for="item in menuItems"
            :key="item.to"
            :to="item.to"
            :class="linkClass(item.cls, false)"
            :active-class="activeClass(item.cls)"
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <!-- 右側：身分／登入（桌機、手機都在）+ 手機漢堡鈕 -->
        <div class="ml-auto flex shrink-0 items-center gap-2">
          <template v-if="sessionHousehold">
            <RouterLink to="/me" class="text-sm text-slate-500 hover:underline">{{ sessionHousehold.戶號 }}</RouterLink>
            <button
              type="button"
              class="hidden rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 sm:inline-block"
              @click="logout"
            >
              登出
            </button>
          </template>
          <RouterLink
            v-else
            to="/me"
            class="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            active-class="bg-slate-900 text-white hover:bg-slate-900"
          >
            登入
          </RouterLink>
          <!-- 漢堡鈕（僅手機） -->
          <button
            type="button"
            class="rounded border border-slate-300 p-2 text-slate-700 hover:bg-slate-100 sm:hidden"
            :aria-expanded="menuOpen"
            aria-label="選單"
            @click="menuOpen = !menuOpen"
          >
            <svg v-if="!menuOpen" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg v-else class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 手機：展開的直式選單（全寬大按鈕，好點） -->
      <nav v-if="menuOpen" class="mx-auto space-y-1 border-t border-slate-200 px-4 py-2 sm:hidden" :class="shellMax">
        <RouterLink
          v-for="item in menuItems"
          :key="item.to"
          :to="item.to"
          :class="linkClass(item.cls, true)"
          :active-class="activeClass(item.cls)"
        >
          {{ item.label }}
        </RouterLink>
        <button
          v-if="sessionHousehold"
          type="button"
          class="mt-1 block w-full rounded-lg border-t border-slate-100 px-4 py-3 pt-4 text-left text-base text-slate-700 hover:bg-slate-100"
          @click="logout"
        >
          登出（{{ sessionHousehold.戶號 }}）
        </button>
      </nav>
    </header>

    <main class="mx-auto px-4 py-6" :class="shellMax">
      <RouterView />
    </main>

    <footer class="mx-auto px-4 py-6 text-xs text-slate-400" :class="shellMax">
      樂菲莊園機車車位管理工具 <span class="text-slate-300">{{ version }}</span>
    </footer>
  </div>
</template>
