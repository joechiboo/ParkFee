<script setup>
import { RouterLink } from 'vue-router'

const flow = [
  { to: '/register', step: '1', label: '登記', desc: '匯入名冊 / 掃描帶車號' },
  { to: '/allocate', step: '2', label: '分階段配位', desc: '固定種子抽籤、可重現' },
  { to: '/result', step: '3', label: '結果與繳費', desc: '車位、應繳、簽約期限' },
  { to: '/export', step: '4', label: 'eTag 白名單匯出', desc: '車號 → 可通行 CSV' },
  { to: '/patrol', step: '5', label: '巡邏稽核', desc: '辨識比對、勸導單' },
]
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold">機車車位登記、抽籤與清潔費管理</h1>
    <p class="mt-2 max-w-2xl text-sm text-slate-600">
      把《社區地下室停車場管理辦法》的機車條文，變成可重現、可稽核的年度作業：
      登記 → 抽籤 → 車位分配 → 繳費 → eTag 名單 → 巡邏稽核。
    </p>

    <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="item in flow"
        :key="item.to"
        :to="item.to"
        class="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-400 hover:shadow-sm"
      >
        <div class="flex items-center gap-2">
          <span class="flex size-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
            {{ item.step }}
          </span>
          <span class="font-semibold">{{ item.label }}</span>
        </div>
        <p class="mt-2 text-sm text-slate-500">{{ item.desc }}</p>
      </RouterLink>
    </div>

    <p class="mt-6 text-xs text-slate-400">
      機車位總數 655：一般大 320、一般小 327、無障礙 8。規則來源以管理辦法為準。
    </p>
  </section>
</template>
