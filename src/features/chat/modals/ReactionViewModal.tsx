import { summarizeReactions } from "../emojiData"
import type { Message } from "../../../types/chat"

export interface ReactionViewModalProps {
  reactionMsgId: number | null
  selected: { messages: Message[] }
  reactionTab: string | null
  setReactionTab: (tab: string | null) => void
  onClose: () => void
  onRemoveMyReaction: (msgId: number) => void
}

export function ReactionViewModal({
  reactionMsgId,
  selected,
  reactionTab,
  setReactionTab,
  onClose,
  onRemoveMyReaction,
}: ReactionViewModalProps) {
  if (reactionMsgId === null) return null
  const reactionMsg = selected.messages.find((m) => m.id === reactionMsgId)
  if (!reactionMsg || !reactionMsg.reactions?.some(Boolean)) return null

  const reactions = reactionMsg.reactions ?? []
  const summary = summarizeReactions(reactions)
  const active = reactionTab
  const shown =
    active === null
      ? reactions
      : reactions.filter((r) => r.emoji === active)

  return (
    <div
      className="fixed inset-0 z-[72] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl flex flex-col max-h-[75vh] overflow-hidden"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Cảm xúc về tin nhắn
          </p>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setReactionTab(null)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor:
                active === null ? "var(--primary)" : "var(--surface)",
              color:
                active === null ? "var(--primary-fg)" : "var(--text)",
              border:
                active === null ? "none" : "1px solid var(--border)",
            }}
          >
            Tất cả {reactions.length}
          </button>
          {summary.map((s) => (
            <button
              key={s.emoji}
              onClick={() => setReactionTab(s.emoji)}
              className="px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 transition-colors"
              style={{
                backgroundColor:
                  active === s.emoji ? "var(--primary)" : "var(--surface)",
                color:
                  active === s.emoji ? "var(--primary-fg)" : "var(--text)",
                border:
                  active === s.emoji ? "none" : "1px solid var(--border)",
              }}
            >
              <span>{s.emoji}</span>
              <span>{s.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto p-2">
          {shown.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-2 py-2 rounded-lg"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                {r.initials}
              </div>
              <span
                className="flex-1 text-sm truncate"
                style={{ color: "var(--text)" }}
              >
                {r.name}
                {r.mine && (
                  <button
                    onClick={() => {
                      onRemoveMyReaction(reactionMsg.id)
                      if (
                        (reactionMsg.reactions ?? []).filter(
                          (x) => x.mine && x.emoji === r.emoji,
                        ).length === 1
                      )
                        setReactionTab(null)
                    }}
                    className="block text-[11px] font-medium mt-0.5 transition-opacity hover:opacity-70"
                    style={{ color: "var(--error)" }}
                  >
                    Nhấp để gỡ
                  </button>
                )}
              </span>
              <span className="text-xl leading-none">{r.emoji}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
