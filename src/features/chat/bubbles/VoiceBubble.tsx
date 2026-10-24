import { useState, useRef, useMemo } from "react"
import type { Message } from "../../../types/chat"

export function colorForName(name: string) {
  const palette = [
    "#0ea5e9",
    "#f59e0b",
    "#10b981",
    "#8b5cf6",
    "#ef4444",
    "#14b8a6",
    "#6366f1",
    "#ec4899",
  ]
  let h = 0
  for (let i = 0; i < name.length; i += 1)
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .slice(0, 2)
    .join("")
}

export function makeBars(seed: string | number, count: number) {
  const bars: number[] = []
  let h = (typeof seed === "number" ? seed : seed.length * 2654435761) >>> 0
  for (let i = 0; i < count; i += 1) {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    bars.push(0.25 + (h % 1000) / 1250)
  }
  return bars
}

export function VoiceBubble({ msg, fromMe }: { msg: Message; fromMe?: boolean }) {
  const url = msg.voice?.url ?? ""
  const initialDur = msg.voice?.duration ?? 0
  const [loadedDur, setLoadedDur] = useState(0)
  const dur = initialDur > 0 ? initialDur : loadedDur
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const bars = useMemo(() => makeBars(msg.id, 34), [msg.id])
  const playingBars = Math.round((cur / Math.max(dur, 1)) * bars.length)
  const fmt = (s: number) => {
    const sec = Math.max(0, Math.round(s))
    const m = Math.floor(sec / 60)
    return `${m}:${String(sec % 60).padStart(2, "0")}`
  }
  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) {
      a.pause()
      setPlaying(false)
    } else {
      a.currentTime = cur
      a.play()
        .then(() => setPlaying(true))
        .catch(() => undefined)
    }
  }
  const seekTo = (clientX: number) => {
    const a = audioRef.current
    const el = audioRef.current?.parentElement as HTMLElement | null
    if (!a || !el) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    a.currentTime = ratio * dur
    setCur(ratio * dur)
  }
  return (
    <div
      className="relative overflow-hidden rounded-xl flex items-center gap-2.5 pr-2.5 py-2"
      style={{
        backgroundColor: fromMe ? "var(--chat-theme-color)" : "var(--surface)",
        border: fromMe ? "none" : "1px solid var(--border)",
        minWidth: 190,
        maxWidth: 260,
        cursor: "pointer",
      }}
      onClick={toggle}
      title="Play / Pause"
    >
      <audio
        ref={audioRef}
        src={url}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (isFinite(d) && d > 0 && !initialDur) {
            setLoadedDur(d)
          }
        }}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false)
          setCur(0)
        }}
      />
      <button
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform hover:scale-110"
        style={{
          backgroundColor: "rgba(255,255,255,0.22)",
          color: "#fff",
        }}
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        title={playing ? "Tạm dừng" : "Phát"}
      >
        {playing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ marginLeft: 1 }}
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>
      <div
        className="flex items-center gap-[2px] flex-1 h-8"
        onClick={(e) => {
          e.stopPropagation()
          seekTo(e.clientX)
        }}
      >
        {bars.map((b, i) => (
          <span
            key={i}
            className="flex-1 rounded-full"
            style={{
              height: `${b * 100}%`,
              backgroundColor:
                i < playingBars
                  ? "#fff"
                  : fromMe
                    ? "rgba(255,255,255,0.45)"
                    : "var(--border)",
            }}
          />
        ))}
      </div>
      <span
        className="text-[11px] tabular-nums flex-shrink-0"
        style={{ color: fromMe ? "rgba(255,255,255,0.9)" : "var(--muted)" }}
      >
        {playing ? fmt(cur) : fmt(playingBars > 0 ? dur - cur : dur)}
      </span>
    </div>
  )
}
