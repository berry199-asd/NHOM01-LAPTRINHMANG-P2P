import { Avatar } from "../../../components/Avatar"
import { ackLabel, ackColor } from "../../../lib/messageStatus"
import type { Message, Conversation } from "../../../types/chat"
import { colorForName, initialsOf } from "./VoiceBubble"

export type Ack =
  | { kind: "none" }
  | { kind: "text"; status: Message["status"]; retryable?: boolean }
  | { kind: "seen"; names: string[] }

export function readAck(msg: Message, conv: Conversation): Ack {
  const mine = conv.messages.filter((m) => m.fromMe && !m.recalled && !m.like)
  const later = mine.filter((m) => m.id > msg.id)
  if (conv.isGroup && msg.seenBy?.length) {
    const names = msg.seenBy
      .filter(
        (s) =>
          !later.some((m2) =>
            (m2.seenBy ?? []).some((s2) => s2.name === s.name),
          ),
      )
      .map((s) => s.name)
    if (names.length) return { kind: "seen", names }
  } else if (!conv.isGroup) {
    if (msg.status === "seen" && !later.some((m2) => m2.status === "seen")) {
      return { kind: "seen", names: [conv.name] }
    }
  }
  if (mine.length && mine[mine.length - 1].id === msg.id) {
    return { kind: "text", status: msg.status ?? "sent", retryable: msg.retryable }
  }
  return { kind: "none" }
}

export function MsgAck({
  ack,
  conv,
  onOpenSeen,
  onRetry,
}: {
  ack: Ack
  conv: Conversation
  onOpenSeen?: () => void
  onRetry?: () => void
}) {
  if (ack.kind === "none") return null
  if (ack.kind === "text") {
    const label = ackLabel(ack.status)
    const color = ackColor(ack.status)
    return (
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-[10px] font-medium" style={{ color }}>
          {label}
        </span>
        {ack.retryable && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            title="Gửi lại tin này"
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "var(--surface)", color: "var(--accent, #38bdf8)" }}
          >
            Gửi lại
          </button>
        )}
      </span>
    )
  }
  const names = ack.names
  const show = names.slice(0, 3)
  const extra = names.length - show.length
  const imgAvatar = !conv.isGroup && conv.avatar
  const clickable = !!conv.isGroup && !!onOpenSeen
  return (
    <button
      type="button"
      onClick={clickable ? onOpenSeen : undefined}
      title={clickable ? `${names.length} người đã xem` : undefined}
      className={
        clickable
          ? "flex items-center flex-shrink-0 -space-x-1.5 cursor-pointer"
          : "flex items-center flex-shrink-0"
      }
    >
      {imgAvatar && (
        <Avatar
          src={conv.avatar}
          initials={conv.initials}
          sizePx={16}
          showPresence={false}
          style={{
            boxShadow: "0 0 0 2px var(--bg)",
            border: "none",
            backgroundColor: "transparent",
          }}
        />
      )}
      {!imgAvatar &&
        show.map((n) => (
          <span
            key={n}
            className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-semibold text-white flex-shrink-0"
            style={{
              backgroundColor: colorForName(n),
              boxShadow: "0 0 0 2px var(--bg)",
            }}
          >
            {initialsOf(n)}
          </span>
        ))}
      {extra > 0 && (
        <span
          className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-semibold flex-shrink-0"
          style={{
            backgroundColor: "var(--surface)",
            color: "var(--text)",
            boxShadow: "0 0 0 2px var(--bg)",
          }}
        >
          +{extra}
        </span>
      )}
    </button>
  )
}
