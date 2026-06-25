import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// 版號＝建置（發佈）時間，台北時區，格式 V202606251242 → 方便確認手機跑的是不是最新版。
const tpe = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }) // "2026-06-25 12:42:33"
const APP_VERSION = 'V' + tpe.slice(0, 16).replace(/[-: ]/g, '')

// GitHub Pages 部署在 https://joechiboo.github.io/ParkFee/ → base 需設為 repo 名
export default defineConfig({
  base: '/ParkFee/',
  plugins: [vue(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  test: {
    environment: 'node',
  },
})
