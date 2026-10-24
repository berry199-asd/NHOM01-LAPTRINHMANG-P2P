import { useState, useRef, useEffect } from "react"
import type { Message, MessageReaction } from "../../types/chat"
import { QUICK_REACTS, summarizeReactions } from "./emojiData"

export const EDIT_WINDOW_MS = 15 * 60 * 1000

export function ReactionBadge({
  reactions,
  side,
  onOpen,
}: {
  reactions: MessageReaction[] | undefined
  side: "mine" | "other"
  onOpen: () => void
}) {
  const summary = summarizeReactions(reactions)
  if (summary.length === 0) return null
  const total = (reactions ?? []).length
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className={`absolute -bottom-2 ${
        side === "mine" ? "right-2" : "left-2"
      } flex items-center justify-center h-5 min-w-5 px-1 rounded-full shadow-sm transition-transform hover:scale-105`}
      style={{
        backgroundColor: "#fff",
        border: "1px solid var(--border)",
        color: "#1f2937",
        zIndex: 10,
        opacity: 1,
      }}
      title="Xem cảm xúc"
    >
      {summary.length === 1 ? (
        <span className="flex items-center leading-none">
          <span className="text-[13px] leading-none">{summary[0].emoji}</span>
          {summary[0].count > 1 && (
            <span className="ml-0.5 text-[10px] font-semibold leading-none">
              {summary[0].count}
            </span>
          )}
        </span>
      ) : (
        <span className="flex items-center leading-none">
          <span className="text-[13px] leading-none">{summary[0].emoji}</span>
          <span className="-ml-1 text-[13px] leading-none">
            {summary[1].emoji}
          </span>
          <span className="ml-0.5 text-[10px] font-semibold leading-none">
            {total}
          </span>
        </span>
      )}
    </button>
  )
}

export function MessageActions({
  msg,
  active,
  onEdit,
  onRecall,
  onDelete,
  onReact,
  onShare,
  onReply,
  side,
}: {
  msg: Message
  active: boolean
  onEdit: (m: Message) => void
  onRecall: (id: number) => void
  onDelete: (id: number) => void
  onReact: (id: number, emoji: string) => void
  onShare: (m: Message) => void
  onReply: (m: Message) => void
  side: "left" | "right"
}) {
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [recallView, setRecallView] = useState(false)
  const [openDir, setOpenDir] = useState<"up" | "down">("up")
  const anchorRef = useRef<HTMLDivElement>(null)
  const measureDir = (panelHeight: number) => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let body: HTMLElement | null = el
    while (body && getComputedStyle(body).overflowY !== "auto") {
      body = body.parentElement
    }
    const top = body ? body.getBoundingClientRect().top : 0
    setOpenDir(r.top - top >= panelHeight ? "up" : "down")
  }
  const canMod =
    msg.fromMe &&
    !msg.recalled &&
    (!msg.sentAt || Date.now() - msg.sentAt <= EDIT_WINDOW_MS)
  const canEdit = canMod && !msg.file && !msg.tag
  const canShare = !msg.recalled && !msg.voice
  const itemStyle = {
    color: "var(--text)",
  }
  useEffect(() => {
    if (!menuOpen && !emojiOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setEmojiOpen(false)
        setRecallView(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [menuOpen, emojiOpen])

  if (!active && !menuOpen && !emojiOpen) return null
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 flex items-center ${
        side === "left" ? "right-full mr-1" : "left-full ml-1"
      }`}
      style={{ zIndex: 40 }}
    >
      <div ref={anchorRef} className="relative flex items-center gap-0.5">
        {emojiOpen && (
          <div
            className={`absolute ${
              openDir === "up" ? "bottom-full mb-1" : "top-full mt-1"
            } left-0 rounded-xl shadow-lg px-1.5 py-1 flex items-center gap-0.5 z-50`}
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            {QUICK_REACTS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onReact(msg.id, e)
                  setEmojiOpen(false)
                }}
                className="text-lg hover:scale-125 transition-transform"
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            const opening = !emojiOpen
            setEmojiOpen((v) => !v)
            setMenuOpen(false)
            setRecallView(false)
            if (opening) measureDir(64)
          }}
          className="w-7 h-7 flex items-center justify-center rounded-full transition-all hover:scale-110 hover:brightness-90"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            opacity: 0.95,
          }}
          title="Cảm xúc"
        >
          😊
        </button>
        <button
          onClick={() => {
            const opening = !menuOpen
            setMenuOpen((v) => !v)
            setEmojiOpen(false)
            setRecallView(false)
            if (opening) measureDir(260)
          }}
          className="w-7 h-7 flex items-center justify-center rounded-full transition-all hover:scale-110 hover:brightness-90"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            opacity: 0.95,
          }}
          title="Tuỳ chọn"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute ${
              openDir === "up" ? "bottom-full mb-1" : "top-full mt-1"
            } rounded-xl shadow-lg py-1.5 min-w-[210px] z-50`}
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            {!recallView ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onReply(msg)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                  style={itemStyle}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 17 4 12 9 7" />
                    <path d="M20 18v-2a4 4 0 00-4-4H4" />
                  </svg>
                  Trả lời
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(msg)
                      setMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm"
                    style={itemStyle}
                  >
                    Chỉnh sửa
                  </button>
                )}
                {canMod && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRecallView(true)
                    }}
                    className="w-full text-left px-3 py-2 text-sm"
                    style={itemStyle}
                  >
                    Thu hồi
                  </button>
                )}
                {msg.recalled && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(msg.id)
                      setMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm"
                    style={{ color: "var(--error)" }}
                  >
                    Xoá chỉ ở phía tôi
                  </button>
                )}
                {canShare && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onShare(msg)
                      setMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm"
                    style={itemStyle}
                  >
                    Chia sẻ
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRecall(msg.id)
                    setRecallView(false)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm"
                  style={{ color: "var(--error)" }}
                >
                  Thu hồi với mọi người
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(msg.id)
                    setRecallView(false)
                    setMenuOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm"
                  style={{ color: "var(--error)" }}
                >
                  Xoá chỉ ở phía tôi
                </button>
                <div
                  className="mt-1 border-t"
                  style={{ borderColor: "var(--border)" }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRecallView(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm mt-1"
                  style={itemStyle}
                >
                  Huỷ
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
