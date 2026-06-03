<script setup>
defineProps({
  title: { type: String, required: true },
  milestone: { type: String, default: '' },
  items: { type: Array, default: () => [] },
})
</script>

<template>
  <section>
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-bold">{{ title }}</h1>
      <span v-if="milestone" class="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        {{ milestone }}
      </span>
    </div>
    <p class="mt-2 text-sm text-slate-500">此模組尚未實作，規劃內容如下：</p>
    <ul class="mt-3 space-y-1.5 text-sm text-slate-600">
      <li v-for="(item, i) in items" :key="i" class="flex gap-2">
        <span class="text-slate-300">·</span>
        <span>{{ item }}</span>
      </li>
    </ul>
  </section>
</template>
