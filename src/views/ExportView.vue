<script setup>
import PageStub from '../components/PageStub.vue'
</script>

<template>
  <PageStub
    title="匯出"
    milestone="M1"
    :items="[
      'eTag 白名單 CSV（車號, 戶號, 車位編號, 有效起, 有效迄）',
      '配位結果 CSV',
      '巡邏稽核 CSV、勸導單（附件四）',
    ]"
  />
</template>
