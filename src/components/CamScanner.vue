<script setup>
// 即時相機辨識（getUserMedia 連續預覽 + 取景框 + Tesseract.js OCR）。掃「車牌」或「車位號」。
// 連續讀到相同有效值兩次 → emit('recognized', {type, value})；也可按「填入」手動採用目前候選。
// ⚠️ 相機需 https（GitHub Pages ✓；本機 http 不給）。辨不到/辨錯 → 父層仍可手動輸入。
// 引擎可換：把 scanOnce 內的 Tesseract 換成 onnxruntime-web（RoboEye ANPR）即可，其餘不動。
import { ref, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits(['recognized', 'close'])

const videoEl = ref(null)
const mode = ref('plate') // 'plate' | 'seat'
const status = ref('啟動中…')
const camErr = ref('')
const candidate = ref('')
const confidence = ref(0)

let stream = null
let worker = null
let running = false
let busy = false
let lastValid = ''
const workCanvas = document.createElement('canvas')

const WHITELIST = {
  seat: '0123456789',
  plate: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-',
}

// 依模式驗證 OCR 文字 → 回有效字串或 ''。車位＝1..655 數字；車牌＝5~8 碼英數。
function validate(text) {
  const t = (text || '').toUpperCase().replace(/\s/g, '')
  if (mode.value === 'seat') {
    const n = t.replace(/\D/g, '')
    return n && +n >= 1 && +n <= 655 ? n : ''
  }
  const clean = t.replace(/[^A-Z0-9]/g, '')
  return clean.length >= 5 && clean.length <= 8 ? clean : ''
}

function setMode(m) {
  mode.value = m
  lastValid = ''
  candidate.value = ''
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, // 後鏡頭
      audio: false,
    })
    videoEl.value.srcObject = stream
    await videoEl.value.play()
  } catch (e) {
    const insecure = location.protocol !== 'https:' && location.hostname !== 'localhost'
    camErr.value = insecure
      ? '相機需要 https（請用部署的網址開，不要用本機 http）'
      : e?.name === 'NotAllowedError'
        ? '相機權限被拒，請允許後重新開啟'
        : '無法開啟相機：' + (e?.message || e?.name || '未知')
  }
}

// 擷取取景框內影像 → 灰階+提對比 → 回 canvas 供 OCR。
function captureBox() {
  const v = videoEl.value
  if (!v || !v.videoWidth) return null
  const vw = v.videoWidth
  const vh = v.videoHeight
  const bw = vw * 0.84
  const bh = vh * 0.18
  const bx = (vw - bw) / 2
  const by = (vh - bh) / 2
  const targetW = Math.min(900, Math.round(bw))
  const scale = targetW / bw
  const c = workCanvas
  c.width = targetW
  c.height = Math.round(bh * scale)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(v, bx, by, bw, bh, 0, 0, c.width, c.height)
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    g = g > 130 ? 255 : g < 90 ? 0 : g // 簡單分段拉對比
    d[i] = d[i + 1] = d[i + 2] = g
  }
  ctx.putImageData(img, 0, 0)
  return c
}

async function scanOnce() {
  if (!running || busy || !worker) return
  const c = captureBox()
  if (!c) return
  busy = true
  try {
    await worker.setParameters({
      tessedit_char_whitelist: WHITELIST[mode.value],
      tessedit_pageseg_mode: '7', // 單行
    })
    const { data } = await worker.recognize(c)
    confidence.value = Math.round(data.confidence || 0)
    const val = validate(data.text)
    if (val) {
      candidate.value = val
      if (val === lastValid) {
        emit('recognized', { type: mode.value, value: val }) // 連兩次相同 → 採用
        lastValid = ''
      } else {
        lastValid = val
      }
    }
  } catch {
    /* 單次失敗忽略，下一輪再試 */
  } finally {
    busy = false
  }
}

async function loop() {
  while (running) {
    await scanOnce()
    await new Promise((r) => setTimeout(r, 350))
  }
}

function accept() {
  if (candidate.value) emit('recognized', { type: mode.value, value: candidate.value })
}

onMounted(async () => {
  await startCamera()
  if (camErr.value) return
  status.value = '辨識引擎載入中…'
  const { createWorker } = await import('tesseract.js')
  worker = await createWorker('eng')
  status.value = '對準框內，自動辨識中…'
  running = true
  loop()
})
onBeforeUnmount(() => {
  running = false
  if (worker) worker.terminate().catch(() => {})
  if (stream) stream.getTracks().forEach((t) => t.stop())
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-black">
    <!-- 影像 -->
    <div class="relative flex-1 overflow-hidden">
      <video ref="videoEl" playsinline muted autoplay class="h-full w-full object-cover"></video>

      <!-- 取景框（對準此框內的車牌/車位號）-->
      <div
        class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style="width: 84%; height: 18%"
      >
        <div class="h-full w-full rounded-lg border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"></div>
      </div>

      <div v-if="camErr" class="absolute inset-x-4 top-4 rounded bg-rose-600/90 p-3 text-sm text-white">{{ camErr }}</div>

      <!-- 候選顯示 -->
      <div v-else class="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-white">
        <div class="text-xs text-slate-300">{{ status }}</div>
        <div class="mt-1 font-mono text-2xl font-bold tracking-wider">{{ candidate || '—' }}</div>
        <div v-if="candidate" class="text-xs text-emerald-300">信心 {{ confidence }}%（穩定自動帶入，或按「填入」）</div>
      </div>
    </div>

    <!-- 控制列 -->
    <div class="flex items-center gap-2 bg-slate-900 p-3">
      <div class="flex overflow-hidden rounded border border-slate-600">
        <button class="px-3 py-1.5 text-sm" :class="mode === 'plate' ? 'bg-emerald-600 text-white' : 'text-slate-300'" @click="setMode('plate')">車牌</button>
        <button class="px-3 py-1.5 text-sm" :class="mode === 'seat' ? 'bg-emerald-600 text-white' : 'text-slate-300'" @click="setMode('seat')">車位號</button>
      </div>
      <button
        class="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        :disabled="!candidate"
        @click="accept"
      >填入</button>
      <button class="ml-auto rounded border border-slate-600 px-4 py-1.5 text-sm text-slate-200" @click="emit('close')">關閉</button>
    </div>
  </div>
</template>
