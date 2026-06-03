<script setup>
import PageStub from '../components/PageStub.vue'
</script>

<template>
  <PageStub
    title="巡邏稽核"
    milestone="M4"
    :items="[
      '選車位 → 拍照辨識 → 比對名冊 → 判定（正常／停錯位／佔用／未登記／空位）',
      '人工確認後才落檔；違規累計達 3 次觸發取消資格',
      '一鍵產生勸導單（附件四）並匯出',
      '照片裝置端處理、不上傳、用後即棄',
    ]"
  />
</template>
