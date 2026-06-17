import { ref } from 'vue'

// 編輯登記用的暫存：MeView 按「編輯」時放入整戶資料、跳到 /register；
// RegisterView 掛載時取用並清空（避免之後新登記誤入編輯模式）。
export const editTarget = ref(null)
