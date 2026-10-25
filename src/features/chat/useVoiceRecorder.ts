import { useState, useRef } from "react"

export const MAX_VOICE_SEC = 60
export const WARN_VOICE_SEC = 50

export interface UseVoiceRecorderOptions {
  pushToast: (msg: string) => void
  onSendVoice: (url: string, duration: number) => void
}

export function useVoiceRecorder({
  pushToast,
  onSendVoice,
}: UseVoiceRecorderOptions) {
  const [recState, setRecState] = useState<"off" | "recording" | "preview">("off")
  const [recSeconds, setRecSeconds] = useState(0)
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const [recDuration, setRecDuration] = useState(0)

  const recRef = useRef<{
    recorder: MediaRecorder | null
    chunks: Blob[]
    start: number
    timer: number | null
    cancelled: boolean
    autoSend: boolean
    warned: boolean
  }>({
    recorder: null,
    chunks: [],
    start: 0,
    timer: null,
    cancelled: false,
    autoSend: false,
    warned: false,
  })

  const cancelRecTimer = () => {
    const rc = recRef.current
    if (rc.timer !== null) {
      window.clearInterval(rc.timer)
      rc.timer = null
    }
  }

  const stopRecording = (cancel: boolean) => {
    const rc = recRef.current
    rc.cancelled = cancel
    if (rc.recorder && rc.recorder.state !== "inactive") rc.recorder.stop()
  }

  const cancelPreview = () => {
    if (recUrl) URL.revokeObjectURL(recUrl)
    setRecUrl(null)
    setRecDuration(0)
    setRecState("off")
  }

  const clearRecordedVoice = () => {
    setRecState("off")
    setRecUrl(null)
    setRecDuration(0)
  }

  const startRecording = () => {
    if (recState === "recording" || recState === "preview") return
    if (!navigator.mediaDevices?.getUserMedia) {
      pushToast("Trình duyệt của bạn không hỗ trợ ghi âm thoại")
      return
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const rc = recRef.current
        rc.chunks = []
        rc.cancelled = false
        rc.autoSend = false
        rc.warned = false
        const rec = new MediaRecorder(stream)
        rc.recorder = rec
        rc.start = Date.now()
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) rc.chunks.push(e.data)
        }
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(rc.chunks, {
            type: rec.mimeType || "audio/webm",
          })
          const dur = Math.min((Date.now() - rc.start) / 1000, MAX_VOICE_SEC)
          const url = URL.createObjectURL(blob)
          if (rc.cancelled) {
            cancelRecTimer()
            URL.revokeObjectURL(url)
            setRecState("off")
            setRecSeconds(0)
            return
          }
          cancelRecTimer()
          setRecDuration(dur)
          setRecUrl(url)
          setRecSeconds(0)
          setRecState(rc.autoSend ? "off" : "preview")
          if (rc.autoSend) onSendVoice(url, dur)
        }
        rec.start()
        setRecState("recording")
        setRecSeconds(0)
        rc.timer = window.setInterval(() => {
          const s = (Date.now() - rc.start) / 1000
          setRecSeconds(s)
          if (s >= WARN_VOICE_SEC && !rc.warned) {
            rc.warned = true
            pushToast(`Sắp đạt giới hạn thời lượng (${MAX_VOICE_SEC} giây)`)
          }
          if (s >= MAX_VOICE_SEC) {
            rc.autoSend = true
            stopRecording(false)
          }
        }, 250)
      })
      .catch(() =>
        pushToast(
          "Không thể truy cập microphone — vui lòng kiểm tra quyền truy cập",
        ),
      )
  }

  return {
    recState,
    recSeconds,
    recUrl,
    recDuration,
    startRecording,
    stopRecording,
    cancelPreview,
    clearRecordedVoice,
  }
}
