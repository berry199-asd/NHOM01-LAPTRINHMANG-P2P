import type { Message } from "../../../types/chat"

export function fmtDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return ""
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

export function readVideoMeta(url: string, cb: (sec: number) => void) {
  try {
    const v = document.createElement("video")
    v.preload = "metadata"
    v.muted = true
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) cb(v.duration)
    }
    v.onerror = () => undefined
    v.src = url
  } catch {
    /* bỏ qua nếu không đọc được metadata */
  }
}

export function replyContent(msg: Message) {
  if (msg.voice)
    return `Ghi âm · ${fmtDuration(Math.floor(msg.voice.duration))}`
  if (msg.file) return `${msg.file.name} · ${msg.file.size}`
  if (msg.tag) return `@${msg.text}`
  return msg.text
}

export function QuoteBlock({
  target,
  tone,
  onJump,
}: {
  target: Message | null
  tone: "mine" | "other"
  onJump?: () => void
}) {
  const mine = tone === "mine"
  const missing = !target
  const recalled = missing || target.recalled
  const title = missing
    ? "Tin nhắn"
    : target.fromMe
      ? "Bạn"
      : (target.senderName ?? "Thành viên")
  const raw = recalled ? "Tin nhắn đã được thu hồi" : replyContent(target)
  const clip = raw.length > 120 ? raw.slice(0, 120) + "…" : raw
  return (
    <button
      type="button"
      onClick={onJump}
      className="w-full flex items-stretch gap-2 rounded-lg overflow-hidden text-left"
      style={{
        cursor: onJump ? "pointer" : "default",
        backgroundColor: mine ? "rgba(255,255,255,0.14)" : "var(--surface)",
        border: mine
          ? "1px solid rgba(255,255,255,0.22)"
          : "1px solid var(--border)",
        padding: 0,
      }}
    >
      <span
        className="w-[3px] flex-shrink-0 self-stretch"
        style={{
          backgroundColor: mine ? "rgba(255,255,255,0.75)" : "var(--primary)",
        }}
      />
      <span className="min-w-0 py-1.5 pr-2">
        <span
          className="block text-[11px] font-semibold truncate"
          style={{ color: mine ? "rgba(255,255,255,0.95)" : "var(--primary)" }}
        >
          {title}
        </span>
        <span
          className="block text-xs truncate"
          style={{ color: mine ? "rgba(255,255,255,0.75)" : "var(--muted)" }}
        >
          {clip || "\u00A0"}
        </span>
      </span>
    </button>
  )
}
