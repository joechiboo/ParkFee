<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bylawCurrent, bylawDraft } from '../data/bylaw-content.js'

const route = useRoute()
const router = useRouter()

// 標紅全文（另開列印用）：由 build-bylaw.mjs 從 docs 複製到 public。
const redlineUrl = `${import.meta.env.BASE_URL}bylaw-redline.html`
const rulesUrl = `${import.meta.env.BASE_URL}rules.html`

const tabs = [
  { key: 'current', label: '現行辦法', doc: bylawCurrent },
  { key: 'draft', label: '修訂草案', doc: bylawDraft },
]

// 頁籤放 query，網址可直接分享到某一版（?v=draft）。
const active = computed(() => (route.query.v === 'draft' ? 'draft' : 'current'))
const doc = computed(() => tabs.find((t) => t.key === active.value).doc)

function go(key) {
  router.replace({ query: key === 'current' ? {} : { v: key } })
}
</script>

<template>
  <section>
    <h1 class="text-2xl font-bold">停車場管理辦法</h1>
    <p class="mt-2 text-sm text-slate-600">
      機車車位的登記、抽籤、繳費、罰則都以本辦法為準。本頁為條文網頁版，
      如與管委會用印之<b>正式公告版</b>有出入，一律以正式公告版為準。
    </p>

    <!-- 頁籤 -->
    <div class="mt-5 flex gap-1 border-b border-slate-200">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="-mb-px rounded-t border-b-2 px-4 py-2 text-sm font-medium transition"
        :class="
          active === tab.key
            ? 'border-slate-900 text-slate-900'
            : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
        "
        @click="go(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 版本資訊 -->
    <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <template v-if="active === 'current'">
        <div class="font-semibold text-slate-800">{{ bylawCurrent.title }}</div>
        <ul class="mt-1 text-slate-500">
          <li v-for="rev in bylawCurrent.revisions" :key="rev">· {{ rev }}</li>
        </ul>
      </template>
      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">草案</span>
          <span class="font-semibold text-slate-800">{{ bylawDraft.title }}</span>
        </div>
        <p class="mt-2 text-slate-600">
          依 2026-08-16 機車位小組決議整理，<b>尚未經管委會例會表決</b>，目前<b>不具效力</b>；
          實際適用請看「現行辦法」頁籤。
        </p>
        <a
          :href="redlineUrl"
          target="_blank"
          rel="noopener"
          class="mt-2 inline-block rounded border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50"
        >
          📄 開啟全文標紅版（開會投影、列印用）↗
        </a>
      </template>
      <p class="mt-2 text-xs text-slate-400">條文更新日 {{ doc.updatedAt }}</p>
    </div>

    <!-- 條文本文 -->
    <article class="prose mt-6 rounded-lg border border-slate-200 bg-white p-5 sm:p-7" v-html="doc.html" />

    <p class="mt-6 text-sm text-slate-500">
      看不慣條文？
      <a :href="rulesUrl" class="text-indigo-600 underline">住戶說明頁</a>
      用白話整理了時序、兩條配位路徑與常見問題。
    </p>
  </section>
</template>

<style scoped>
/* v-html 進來的條文沒有 Tailwind class，這裡用 :deep 統一排版（本專案沒裝 typography 外掛）。 */
.prose :deep(h2) {
  margin: 2rem 0 0.75rem;
  border-left: 4px solid #0f172a;
  padding-left: 0.6rem;
  font-size: 1.15rem;
  font-weight: 800;
  line-height: 1.6;
}
.prose :deep(h2:first-child) {
  margin-top: 0;
}
.prose :deep(h3) {
  margin: 1.5rem 0 0.5rem;
  font-size: 1rem;
  font-weight: 700;
  color: #334155;
}
.prose :deep(p) {
  margin: 0.7rem 0;
  line-height: 1.9;
  text-align: justify;
}
.prose :deep(ul),
.prose :deep(ol) {
  margin: 0.6rem 0;
  padding-left: 1.4rem;
  line-height: 1.9;
}
.prose :deep(ul) {
  list-style: none;
  padding-left: 0.9rem;
}
.prose :deep(ol) {
  list-style: decimal;
}
.prose :deep(li) {
  margin: 0.35rem 0;
}
.prose :deep(li > ul) {
  margin: 0.35rem 0 0.35rem 1.1rem;
}
.prose :deep(strong) {
  font-weight: 700;
  color: #0f172a;
}
.prose :deep(code) {
  border-radius: 0.25rem;
  background: #f1f5f9;
  padding: 0.1rem 0.35rem;
  font-size: 0.9em;
}
.prose :deep(a) {
  color: #4f46e5;
  text-decoration: underline;
}
.prose :deep(blockquote) {
  margin: 0.8rem 0;
  border-left: 3px solid #cbd5e1;
  background: #f8fafc;
  padding: 0.5rem 0.9rem;
  color: #475569;
  font-size: 0.93em;
}
.prose :deep(blockquote p) {
  margin: 0.25rem 0;
}
.prose :deep(hr) {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid #e2e8f0;
}
/* 表格較寬，手機讓它自己橫向捲，不要把整頁撐開 */
.prose :deep(.tbl) {
  margin: 0.9rem 0;
  overflow-x: auto;
}
.prose :deep(table) {
  min-width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
.prose :deep(th),
.prose :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 0.45rem 0.7rem;
  text-align: left;
  vertical-align: top;
  line-height: 1.7;
}
.prose :deep(th) {
  background: #f8fafc;
  font-weight: 700;
  white-space: nowrap;
}
</style>
