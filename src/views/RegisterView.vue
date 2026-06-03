<script setup>
import PageStub from '../components/PageStub.vue'
</script>

<template>
  <PageStub
    title="登記"
    milestone="M1 / M2"
    :items="[
      '匯入登記名冊 CSV（戶號, 車號, 車種, 第幾輛, 身障, 志願小位, 登記時間, 聯絡電話）',
      'schema 驗證，錯誤明確提示',
      '（M2）拍照／框選車牌 → OCR 帶入車號，人工可修正',
    ]"
  />
</template>
