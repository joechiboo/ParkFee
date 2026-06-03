import { createRouter, createWebHashHistory } from 'vue-router'

// 用 hash history：GitHub Pages 無後端、無法處理深層路徑 fallback，hash 最穩。
const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '首頁' } },
  { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { title: '登記' } },
  { path: '/allocate', name: 'allocate', component: () => import('../views/AllocateView.vue'), meta: { title: '配位' } },
  { path: '/result', name: 'result', component: () => import('../views/ResultView.vue'), meta: { title: '結果' } },
  { path: '/patrol', name: 'patrol', component: () => import('../views/PatrolView.vue'), meta: { title: '巡邏稽核' } },
  { path: '/export', name: 'export', component: () => import('../views/ExportView.vue'), meta: { title: '匯出' } },
]

export default createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
})
