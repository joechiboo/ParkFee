import { createRouter, createWebHashHistory } from 'vue-router'
import { sessionHousehold } from '../store/session.js'
import { isAdmin } from '../store/roles.js'

// 用 hash history：GitHub Pages 無後端、無法處理深層路徑 fallback，hash 最穩。
const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '首頁' } },
  { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue'), meta: { title: '登記' } },
  { path: '/me', name: 'me', component: () => import('../views/MeView.vue'), meta: { title: '我的登記' } },
  { path: '/select', name: 'select', component: () => import('../views/SelectView.vue'), meta: { title: '選車位志願' } },
  {
    path: '/seat-admin',
    name: 'seat-admin',
    component: () => import('../views/SeatAdminView.vue'),
    meta: { title: '車位鎖定維護' },
    beforeEnter: (to) => (isAdmin(sessionHousehold.value) ? true : { name: 'me' }), // 僅管理員
  },
  {
    path: '/allocate',
    name: 'allocate',
    component: () => import('../views/AllocateView.vue'),
    meta: { title: '配位' },
    // 公開：預設跑範例 demo（鄰居可玩、看演算法）。真實名冊匯入在 dev 專區（限管理員）。
  },
  { path: '/result', name: 'result', component: () => import('../views/ResultView.vue'), meta: { title: '結果' } },
  {
    path: '/patrol',
    name: 'patrol',
    component: () => import('../views/PatrolView.vue'),
    meta: { title: '巡邏稽核' },
    beforeEnter: () => (isAdmin(sessionHousehold.value) ? true : { name: 'me' }), // 巡邏讀指派個資 → 限管理員
  },
]

// 工程師專區：只在開發模式註冊；正式 build（npm run build / GitHub Pages）import.meta.env.DEV=false
// → 此路由與 DevView/mock 程式碼一併被 tree-shake，不會上線。
if (import.meta.env.DEV) {
  routes.push({
    path: '/dev',
    name: 'dev',
    component: () => import('../views/DevView.vue'),
    meta: { title: '工程師專區' },
    beforeEnter: () => (isAdmin(sessionHousehold.value) ? true : { name: 'me' }), // dev 專區（含真實名冊匯入）限管理員
  })
}

export default createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes,
})
