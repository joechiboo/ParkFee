<script setup>
// 住戶說明頁 — 內容來源 docs/01-車位使用實施細則.md，由 build-bylaw.mjs 轉成 houseRules。
// 條文的白話版：規則以《管理辦法》為準，本頁只講「怎麼進行」。
// ⚠️ 勿在此頁手寫規則內容，改 docs/01 後跑 npm run build:bylaw —— 這頁存在的理由就是
//    取代原本手維護的 public/rules.html（它與條文各自漂移，一度過期三個月）。
import { RouterLink } from 'vue-router'
import { houseRules } from '../data/bylaw-content.js'

// 細則經管委會核定後，把這行改成 false（badge 與提示會一併消失）。
const 待核定 = true
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold">{{ houseRules.title }}</h1>
    <p class="mt-2 max-w-2xl text-sm text-slate-600">
      一頁看懂登記、抽籤、配位、繳費、換位與自行車怎麼進行。
      規則以<RouterLink to="/bylaw" class="text-indigo-600 underline">停車場管理辦法</RouterLink>為準，
      本頁只講做法；內文括號內為對應條次。
    </p>

    <div class="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div v-if="待核定" class="flex flex-wrap items-center gap-2">
        <span class="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">草案</span>
        <span class="text-slate-600">依 2026-09-03 例會決議整理，尚待管委會核定；如與辦法有出入，以辦法為準。</span>
      </div>
      <p class="text-xs text-slate-400" :class="待核定 && 'mt-2'">內容更新日 {{ houseRules.updatedAt }}</p>
    </div>

    <article class="doc-prose mt-6 rounded-lg border border-slate-200 bg-white p-5 sm:p-7" v-html="houseRules.html" />

    <div class="mt-6 flex flex-wrap gap-3 text-sm">
      <RouterLink
        to="/register"
        class="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 font-medium text-indigo-800 hover:bg-indigo-100"
      >
        前往登記 →
      </RouterLink>
      <RouterLink to="/bylaw" class="rounded border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">
        看完整條文
      </RouterLink>
    </div>
  </section>
</template>
