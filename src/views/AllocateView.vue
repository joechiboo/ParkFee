<script setup>
import PageStub from '../components/PageStub.vue'
</script>

<template>
  <PageStub
    title="分階段配位"
    milestone="M1"
    :items="[
      '純函式配位引擎，固定種子 → 結果可重現',
      '階段 0 無障礙 → 階段 1 保障每戶第 1 輛 → 階段 2 剩餘開放多位＋候補',
      '顯示亂數種子、執行時間、各階段過程可展開供監察',
    ]"
  />
</template>
