<script setup>
// 戶號輸入「＿號＿樓」（2026-11-10 經理建議）：第一格填門牌號碼（297）或房型（H3）皆可，
// 第二格填樓層（必填），系統算出戶號。v-model＝戶號字串；沒填完或查不到時為空字串。
//
// allowRaw（登入頁用）：樓層留空且第一格不是門牌號碼／房型時，把第一格原樣當戶號送出。
//   給管理員帳號（admin）、工作人員（員工-姓名）、以及戶號先前填錯尚未更正的住戶（如 B3-385）登入用。
import { ref, computed, watch } from 'vue'
import { householdFromDoor, isUnitCode, normalizeHousehold } from '../data/household.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  allowRaw: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const first = ref('')
const floor = ref('')

const isRaw = computed(() => {
  const a = first.value.trim()
  return props.allowRaw && !!a && !floor.value.trim() && !/^[0-9０-９]+$/.test(a) && !isUnitCode(a)
})
const resolved = computed(() =>
  isRaw.value ? { id: normalizeHousehold(first.value), raw: true } : householdFromDoor(first.value, floor.value),
)
watch(resolved, (r) => emit('update:modelValue', r.id || ''))
// 呼叫端清空表單（例如櫃台登打下一筆）→ 跟著清欄位
watch(
  () => props.modelValue,
  (v) => {
    if (!v && resolved.value.id) {
      first.value = ''
      floor.value = ''
    }
  },
)
const inputCls =
  'rounded border border-slate-300 px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none'
</script>

<template>
  <div>
    <div class="mt-1 flex flex-wrap items-center gap-2">
      <input v-model="first" type="text" placeholder="297 或 H3" aria-label="門牌號碼或房型" style="text-transform: uppercase" :class="[inputCls, 'w-32 text-center']" />
      <span class="text-sm text-slate-700">號</span>
      <input v-model="floor" type="text" inputmode="numeric" placeholder="6" aria-label="樓層" :class="[inputCls, 'w-20 text-center']" />
      <span class="text-sm text-slate-700">樓</span>
    </div>
    <span v-if="resolved.id && !resolved.raw" class="mt-1 block text-xs text-emerald-700">戶號：<b class="font-mono">{{ resolved.id }}</b></span>
    <span v-else-if="resolved.error" class="mt-1 block text-xs text-red-600">{{ resolved.error }}</span>
    <span v-else-if="!resolved.raw" class="mt-1 block text-xs text-slate-500">
      第一格填<b>門牌號碼</b>或<b>房型</b>都可以，樓層一定要填。例：297 號 6 樓，或 H3 號 6 樓
    </span>
  </div>
</template>
