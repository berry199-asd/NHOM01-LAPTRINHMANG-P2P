/**
 * Quản lý nhạc chuông cuộc gọi (Ringtone) và âm hồi chuông (Ringback Tone)
 * - Lưu trữ cục bộ độc lập trên từng máy
 * - Tự động lưu file âm thanh tải lên vào IndexedDB (tránh lỗi tràn bộ nhớ 5MB của localStorage)
 * - Hỗ trợ các giai điệu synth tích hợp sẵn (không cần tải file ngoài, 0 dependencies)
 * - Tự động phát khi có cuộc gọi đến/đi và dừng ngay khi bắt máy hoặc gác máy
 */

const STORAGE_KEY_RINGTONE = "workchat_ringtone_id"
const STORAGE_KEY_CUSTOM_NAME = "workchat_ringtone_custom_name"
const STORAGE_KEY_VOLUME = "workchat_ringtone_volume"

// IndexedDB cho file âm thanh tùy chỉnh (dung lượng không giới hạn như localStorage)
const IDB_NAME = "workchat_ringtone_db"
const IDB_VERSION = 1
const IDB_STORE = "custom_ringtone_store"
const IDB_KEY = "active_custom_ringtone"

export interface BuiltinRingtone {
  id: string
  name: string
  desc: string
}

export const BUILTIN_RINGTONES: BuiltinRingtone[] = [
  { id: "marimba", name: "Marimba Vui Tươi", desc: "Giai điệu mộc cầm rộn ràng, hiện đại" },
  { id: "chimes", name: "Digital Chimes", desc: "Chuông điện tử ngân vang, thanh thoát" },
  { id: "bell", name: "Chuông Cổ Điển", desc: "Tiếng chuông điện thoại cổ điển trang trọng" },
  { id: "gentle", name: "Nhẹ Nhàng (Gentle Breeze)", desc: "Âm hưởng êm dịu, không giật mình" },
  { id: "custom", name: "Nhạc chuông tự tải lên", desc: "File âm thanh từ máy tính của bạn" },
]

export interface RingtoneConfig {
  id: string
  customDataUrl?: string
  customName?: string
  volume: number // 0 to 1
}

// Bộ đệm Object URL trong RAM của file âm thanh tải lên
let cachedCustomUrl: string | undefined = undefined

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB không được hỗ trợ"))
      return
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Lưu file âm thanh tải lên vào IndexedDB
 */
export async function setCustomRingtoneFile(file: File): Promise<string> {
  try {
    const db = await openIdb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite")
      const store = tx.objectStore(IDB_STORE)
      const putReq = store.put({ blob: file, name: file.name, type: file.type, updatedAt: Date.now() }, IDB_KEY)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    })

    if (cachedCustomUrl) {
      try {
        URL.revokeObjectURL(cachedCustomUrl)
      } catch {}
    }
    cachedCustomUrl = URL.createObjectURL(file)

    saveRingtoneConfig({
      id: "custom",
      customName: file.name,
      customDataUrl: cachedCustomUrl,
    })

    return cachedCustomUrl
  } catch (err) {
    console.error("[ringtone] Lỗi lưu vào IndexedDB:", err)
    throw err
  }
}

/**
 * Nạp file âm thanh từ IndexedDB vào bộ đệm URL khi mở trang
 */
export async function initRingtone(): Promise<string | undefined> {
  if (typeof indexedDB === "undefined") return undefined
  if (cachedCustomUrl) return cachedCustomUrl
  try {
    const db = await openIdb()
    const record = await new Promise<{ blob: Blob; name: string } | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly")
      const store = tx.objectStore(IDB_STORE)
      const getReq = store.get(IDB_KEY)
      getReq.onsuccess = () => {
        const val = getReq.result
        if (val && val.blob) {
          resolve({ blob: val.blob, name: val.name || "custom.mp3" })
        } else {
          resolve(null)
        }
      }
      getReq.onerror = () => reject(getReq.error)
    })

    if (record && record.blob) {
      cachedCustomUrl = URL.createObjectURL(record.blob)
      if (!localStorage.getItem(STORAGE_KEY_CUSTOM_NAME) && record.name) {
        saveRingtoneConfig({ customName: record.name })
      }
      return cachedCustomUrl
    }
  } catch (err) {
    console.warn("[ringtone] Không thể nạp nhạc chuông từ IndexedDB:", err)
  }
  return undefined
}

// Tự động khởi tạo ngay khi nạp module
void initRingtone()

export function loadRingtoneConfig(): RingtoneConfig {
  let id = "marimba"
  let customName: string | undefined = undefined
  let volume = 0.85

  try {
    id = localStorage.getItem(STORAGE_KEY_RINGTONE) || "marimba"
    customName = localStorage.getItem(STORAGE_KEY_CUSTOM_NAME) || undefined
    const volStr = localStorage.getItem(STORAGE_KEY_VOLUME)
    if (volStr !== null) {
      const parsed = Number.parseFloat(volStr)
      if (!Number.isNaN(parsed)) volume = parsed
    }
  } catch {}

  return {
    id,
    customDataUrl: cachedCustomUrl,
    customName,
    volume,
  }
}

export function saveRingtoneConfig(cfg: Partial<RingtoneConfig>) {
  try {
    if (cfg.id !== undefined) {
      localStorage.setItem(STORAGE_KEY_RINGTONE, cfg.id)
    }
    if (cfg.customName !== undefined) {
      localStorage.setItem(STORAGE_KEY_CUSTOM_NAME, cfg.customName)
    }
    if (cfg.volume !== undefined) {
      localStorage.setItem(STORAGE_KEY_VOLUME, cfg.volume.toString())
    }
    if (cfg.customDataUrl !== undefined) {
      cachedCustomUrl = cfg.customDataUrl
    }
  } catch (e) {
    console.warn("[ringtone] Lỗi lưu cấu hình vào localStorage:", e)
  }
}

// ============ Web Audio Synthesizer ============

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass()
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume()
    }
    return audioCtx
  } catch {
    return null
  }
}

let activeInterval: number | null = null
let customAudioEl: HTMLAudioElement | null = null
let isPlaying = false

/**
 * Phát giai điệu chuông synth theo chu kỳ
 */
function playSynthMelody(type: string, volume: number) {
  const ctx = getAudioCtx()
  if (!ctx) return

  const notesMap: Record<string, { freq: number; dur: number; delay: number }[]> = {
    marimba: [
      { freq: 523.25, dur: 0.12, delay: 0 },     // C5
      { freq: 659.25, dur: 0.12, delay: 150 },   // E5
      { freq: 783.99, dur: 0.14, delay: 300 },   // G5
      { freq: 1046.5, dur: 0.22, delay: 460 },   // C6
      { freq: 880.0, dur: 0.14, delay: 720 },    // A5
      { freq: 1046.5, dur: 0.28, delay: 900 },   // C6
    ],
    chimes: [
      { freq: 587.33, dur: 0.18, delay: 0 },     // D5
      { freq: 880.0, dur: 0.18, delay: 200 },    // A5
      { freq: 1174.66, dur: 0.35, delay: 420 },  // D6
      { freq: 987.77, dur: 0.22, delay: 800 },   // B5
      { freq: 1174.66, dur: 0.4, delay: 1050 },  // D6
    ],
    bell: [
      { freq: 800, dur: 0.08, delay: 0 },
      { freq: 850, dur: 0.08, delay: 90 },
      { freq: 800, dur: 0.08, delay: 180 },
      { freq: 850, dur: 0.08, delay: 270 },
      { freq: 800, dur: 0.35, delay: 380 },
    ],
    gentle: [
      { freq: 440.0, dur: 0.25, delay: 0 },      // A4
      { freq: 554.37, dur: 0.25, delay: 260 },   // C#5
      { freq: 659.25, dur: 0.3, delay: 540 },    // E5
      { freq: 880.0, dur: 0.5, delay: 860 },     // A5
    ],
  }

  const pattern = notesMap[type] || notesMap.marimba

  const playOnce = () => {
    if (!isPlaying) return
    const now = ctx.currentTime
    const masterGain = ctx.createGain()
    masterGain.gain.setValueAtTime(Math.max(0.01, Math.min(volume * 0.4, 0.9)), now)
    masterGain.connect(ctx.destination)

    pattern.forEach((n) => {
      const osc = ctx.createOscillator()
      const noteGain = ctx.createGain()

      osc.type = type === "bell" ? "square" : "sine"
      osc.frequency.setValueAtTime(n.freq, now + n.delay / 1000)

      const start = now + n.delay / 1000
      noteGain.gain.setValueAtTime(0.001, start)
      noteGain.gain.exponentialRampToValueAtTime(1.0, start + 0.02)
      noteGain.gain.exponentialRampToValueAtTime(0.001, start + n.dur)

      osc.connect(noteGain)
      noteGain.connect(masterGain)

      osc.start(start)
      osc.stop(start + n.dur + 0.05)
    })
  }

  playOnce()
  // Lặp lại mỗi 2.8 giây
  activeInterval = window.setInterval(playOnce, 2800)
}

/**
 * Phát âm hồi chuông cho cuộc gọi đi (tiếng "tút... tút..." chuẩn điện thoại)
 */
function playOutgoingDialTone(volume: number) {
  const ctx = getAudioCtx()
  if (!ctx) return

  const playBeep = () => {
    if (!isPlaying) return
    const now = ctx.currentTime

    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const gain = ctx.createGain()

    // Tần số chuẩn US/International Ringback: 440Hz + 480Hz
    osc1.type = "sine"
    osc1.frequency.setValueAtTime(440, now)

    osc2.type = "sine"
    osc2.frequency.setValueAtTime(480, now)

    const dur = 1.4 // tút kéo dài 1.4s
    const targetVol = Math.max(0.01, Math.min(volume * 0.15, 0.4))

    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(targetVol, now + 0.05)
    gain.gain.setValueAtTime(targetVol, now + dur - 0.05)
    gain.gain.linearRampToValueAtTime(0.001, now + dur)

    osc1.connect(gain)
    osc2.connect(gain)
    gain.connect(ctx.destination)

    osc1.start(now)
    osc2.start(now)
    osc1.stop(now + dur)
    osc2.stop(now + dur)
  }

  playBeep()
  // Lặp lại: 1.4s kêu + 3.0s nghỉ = chu kỳ 4.4 giây
  activeInterval = window.setInterval(playBeep, 4400)
}

// ============ API CHÍNH ============

/**
 * Bắt đầu phát nhạc chuông cuộc gọi ĐẾN
 */
export function startIncomingRingtone() {
  stopAllRingtones()
  isPlaying = true
  const cfg = loadRingtoneConfig()

  const customUrl = cfg.customDataUrl || cachedCustomUrl
  if (cfg.id === "custom" && customUrl) {
    try {
      customAudioEl = new Audio(customUrl)
      customAudioEl.loop = true
      customAudioEl.volume = Math.max(0, Math.min(cfg.volume, 1))
      customAudioEl.play().catch(() => {})
      return
    } catch {}
  }

  playSynthMelody(cfg.id, cfg.volume)
}

/**
 * Bắt đầu phát âm báo "tút... tút..." cuộc gọi ĐI
 */
export function startOutgoingRingback() {
  stopAllRingtones()
  isPlaying = true
  const cfg = loadRingtoneConfig()
  playOutgoingDialTone(cfg.volume)
}

/**
 * Nghe thử nhạc chuông trong màn hình cài đặt
 */
export function previewRingtone(id: string, customDataUrl?: string, volume = 0.85) {
  stopAllRingtones()
  isPlaying = true

  const audioUrl = customDataUrl || cachedCustomUrl
  if (id === "custom" && audioUrl) {
    try {
      customAudioEl = new Audio(audioUrl)
      customAudioEl.volume = Math.max(0, Math.min(volume, 1))
      customAudioEl.play().catch(() => {})
      return
    } catch {}
  }

  playSynthMelody(id, volume)
}

/**
 * Dừng toàn bộ âm thanh chuông đang phát
 */
export function stopAllRingtones() {
  isPlaying = false
  if (activeInterval !== null) {
    clearInterval(activeInterval)
    activeInterval = null
  }
  if (customAudioEl) {
    try {
      customAudioEl.pause()
      customAudioEl.currentTime = 0
    } catch {}
    customAudioEl = null
  }
}
