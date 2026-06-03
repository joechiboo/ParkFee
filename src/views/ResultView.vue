<script setup>
import PageStub from '../components/PageStub.vue'
</script>

<template>
  <PageStub
    title="結果與繳費"
    milestone="M1"
    :items="[
      '配位結果：戶號 / 車號 / 車位編號 / 類型 / 應繳 / 簽約期限 / 狀態',
      '費用計算（一般 1,200、重機 3,600）',
      '繳費狀態、放棄則候補遞補',
    ]"
  />
</template>
