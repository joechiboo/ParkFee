<script setup>
import { RouterLink, RouterView } from 'vue-router'

// 主導覽（管委會作業）；登入 (/me) 另放右側
const nav = [
  { to: '/register', label: '登記' },
  { to: '/allocate', label: '配位' },
  { to: '/result', label: '結果' },
  { to: '/patrol', label: '巡邏稽核' },
  { to: '/export', label: '匯出' },
]
</script>

<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:gap-6">
        <RouterLink to="/" class="shrink-0 text-lg font-bold tracking-tight text-slate-900">
          ParkFee
        </RouterLink>
        <nav class="-mx-1 flex flex-nowrap gap-1 overflow-x-auto px-1 text-sm sm:flex-wrap">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="shrink-0 rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100"
            active-class="bg-slate-900 text-white hover:bg-slate-900"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <RouterLink
          to="/me"
          class="ml-auto shrink-0 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          active-class="bg-slate-900 text-white hover:bg-slate-900"
        >
          登入
        </RouterLink>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 py-6">
      <RouterView />
    </main>

    <footer class="mx-auto max-w-5xl px-4 py-6 text-xs text-slate-400">
      樂菲莊園機車車位管理工具
    </footer>
  </div>
</template>
