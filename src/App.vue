<script setup>
import { RouterLink, RouterView } from 'vue-router'

const nav = [
  { to: '/', label: '首頁' },
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
      <div class="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <RouterLink to="/" class="text-lg font-bold tracking-tight text-slate-900">
          ParkFee
        </RouterLink>
        <nav class="flex flex-wrap gap-1 text-sm">
          <RouterLink
            v-for="item in nav.slice(1)"
            :key="item.to"
            :to="item.to"
            class="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100"
            active-class="bg-slate-900 text-white hover:bg-slate-900"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 py-6">
      <RouterView />
    </main>

    <footer class="mx-auto max-w-5xl px-4 py-6 text-xs text-slate-400">
      樂菲莊園機車車位管理工具 · 純前端 · 不存身分證號
    </footer>
  </div>
</template>
