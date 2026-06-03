import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 部署在 https://joechiboo.github.io/ParkFee/ → base 需設為 repo 名
export default defineConfig({
  base: '/ParkFee/',
  plugins: [vue(), tailwindcss()],
  test: {
    environment: 'node',
  },
})
