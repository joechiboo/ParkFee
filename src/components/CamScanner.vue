<script setup>
// 即時相機辨識（getUserMedia 連續預覽 + PaddleOCR 偵測+辨識）。掃「車牌」或「車位號」。
// PaddleOCR 內建文字「偵測」→ 會自動找出框內任意位置/大小的文字（車牌不必對齊填滿）→ 再辨識，
// 我從偵測到的多個文字中挑「符合該模式格式」者（車牌 6–7 碼英數 / 車位 1–655 數字）。
// 連續讀到相同有效值兩次 → emit('recognized')；也可按「填入」採用目前候選。
// ⚠️ 相機需 https（GitHub Pages ✓；本機 http 不給）。辨不到/辨錯 → 父層仍可手動輸入。
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { ensureOcr, ocrRecognizeTexts, ocrStage, ocrProgress } from '../lib/ocr.js'

const emit = defineEmits(['recognized', 'close'])
// 父層檢查結果 → 相機上浮層顯示（連續巡查不用離開相機）。
const props = defineProps({ feedback: { type: Object, default: null } })
const flash = ref(null)
watch(
  () => props.feedback,
  (f) => {
    if (!f) return
    flash.value = f
    if (f.status === 'error' && navigator.vibrate) navigator.vibrate(200) // 違規震動提示
    setTimeout(() => {
      if (flash.value === f) flash.value = null
    }, 2800)
  },
)

const videoEl = ref(null)
const mode = ref('plate') // 'plate' | 'seat'
const status = ref('啟動中…')
const camErr = ref('')
const candidate = ref('')

let stream = null
let ready = false
let running = false
let busy = false
let lastValid = ''
const workCanvas = document.createElement('canvas')

// 依模式驗證一段 OCR 文字 → 回有效字串或 ''。車位＝1..655 數字；車牌＝6~7 碼英數。
function validate(text) {
  const t = (text || '').toUpperCase()
  if (mode.value === 'seat') {
    const n = t.replace(/\D/g, '')
    return n && +n >= 1 && +n <= 655 ? n : ''
  }
  const clean = t.replace(/[^A-Z0-9]/g, '')
  return clean.length >= 6 && clean.length <= 7 ? clean : '' // 機車車牌約 6–7 碼
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

// 擷取取景框內影像（彩色，給 PaddleOCR 自己做偵測/前處理）→ 回 canvas。
function captureBox() {
  const v = videoEl.value
  if (!v || !v.videoWidth) return null
  const vw = v.videoWidth
  const vh = v.videoHeight
  const bw = vw * 0.9
  const bh = vh * 0.45
  const bx = (vw - bw) / 2
  const by = (vh - bh) / 2
  const targetW = Math.min(720, Math.round(bw))
  const scale = targetW / bw
  const c = workCanvas
  c.width = targetW
  c.height = Math.round(bh * scale)
  c.getContext('2d').drawImage(v, bx, by, bw, bh, 0, 0, c.width, c.height)
  return c
}

async function scanOnce() {
  if (!running || busy || !ready) return
  const c = captureBox()
  if (!c) return
  busy = true
  try {
    const texts = await ocrRecognizeTexts(c)
    let found = ''
    for (const t of texts) {
      const v = validate(t)
      if (v) {
        found = v
        break
      }
    }
    if (found) {
      candidate.value = found
      if (found === lastValid) {
        emit('recognized', { type: mode.value, value: found }) // 連兩次相同 → 採用
        lastValid = ''
      } else {
        lastValid = found
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
    await new Promise((r) => setTimeout(r, 500))
  }
}

function accept() {
  if (candidate.value) emit('recognized', { type: mode.value, value: candidate.value })
}

onMounted(async () => {
  await startCamera()
  if (camErr.value) return
  status.value = '辨識引擎載入中…（首次需下載模型，請稍候；之後快取不再下載）'
  try {
    await ensureOcr()
    ready = true
    status.value = '把車牌放進框內，自動辨識中…'
  } catch (e) {
    camErr.value = '辨識引擎載入失敗：' + (e?.message || e?.name || '未知')
    return
  }
  running = true
  loop()
})
onBeforeUnmount(() => {
  running = false
  if (stream) stream.getTracks().forEach((t) => t.stop())
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col bg-black">
    <!-- 影像 -->
    <div class="relative flex-1 overflow-hidden">
      <video ref="videoEl" playsinline muted autoplay class="h-full w-full object-cover"></video>

      <!-- 取景框（把車牌放進這個範圍即可，不必對齊填滿）-->
      <div
        class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style="width: 90%; height: 45%"
      >
        <div class="h-full w-full rounded-lg border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"></div>
      </div>

      <div v-if="camErr" class="absolute inset-x-4 top-4 rounded bg-rose-600/90 p-3 text-sm text-white">{{ camErr }}</div>

      <!-- 檢查結果浮層（自動檢查後顯示，連續巡查不用離開相機）-->
      <div
        v-if="flash"
        class="absolute inset-x-3 top-3 rounded-lg border-2 p-3 text-center text-sm font-bold text-white"
        :class="flash.status === 'error' ? 'border-rose-300 bg-rose-600/90' : flash.status === 'warn' ? 'border-amber-300 bg-amber-500/90' : 'border-emerald-300 bg-emerald-600/90'"
      >
        {{ flash.status === 'error' ? '🔴' : flash.status === 'warn' ? '⚠️' : '🟢' }}
        車位 {{ flash.seatId }} · {{ flash.message }}
      </div>

      <!-- 載入中（含下載進度）/ 候選顯示 -->
      <div v-else class="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-white">
        <template v-if="ocrStage">
          <div class="text-sm">辨識引擎準備中 · {{ ocrStage }}<span v-if="ocrStage === '下載模型'"> {{ ocrProgress }}%</span></div>
          <div v-if="ocrStage === '下載模型'" class="mx-auto mt-2 h-2 w-4/5 overflow-hidden rounded-full bg-slate-700">
            <div class="h-full rounded-full bg-emerald-400 transition-all" :style="{ width: ocrProgress + '%' }"></div>
          </div>
          <div class="mt-1 text-xs text-slate-400">首次約 12MB，下載後快取、下次免下載</div>
        </template>
        <template v-else>
          <div class="text-xs text-slate-300">{{ status }}</div>
          <div class="mt-1 font-mono text-2xl font-bold tracking-wider">{{ candidate || '—' }}</div>
          <div v-if="candidate" class="text-xs text-emerald-300">穩定後自動帶入，或按「填入」</div>
        </template>
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
