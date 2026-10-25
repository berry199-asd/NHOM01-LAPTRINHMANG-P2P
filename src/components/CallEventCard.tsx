/**
 * Thẻ sự kiện cuộc gọi trong dòng tin nhắn (kiểu Messenger/Zalo).
 *
 * Chỉ HIỂN THỊ: mọi quyết định về câu chữ/trạng thái nằm ở `lib/callEvent.ts`.
 * Thẻ nằm về phía NGƯỜI BẮT ĐẦU (bên gọi phải, bên nhận trái); giờ hiển thị dưới
 * thẻ dùng đúng kiểu giờ của tin nhắn thường.
 */

import { type KeyboardEvent } from "react"
import {
  CALL_TONES,
  callEventPillText,
  callEventView,
  type CallEvent,
  type CallIcon,
  type CallMedia,
} from "../lib/callEvent"
import { colorForName } from "../lib/callView"
import { usePersonAvatar } from "../lib/personDirectory"
import { Avatar } from "./Avatar"

function CallGlyph({
  icon,
  color,
  size = 20,
}: {
  icon: CallIcon
  color: string
  size?: number
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  }
  if (icon === "video") {
    return (
      <svg {...common}>
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    )
  }
  if (icon === "phone-missed") {
    return (
      <svg {...common}>
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.07 9.81a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 2 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L6.91 8.27a16 16 0 0 0 6.29 6.29l1.63-1.34a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        <line x1="23" y1="1" x2="17" y2="7" />
        <line x1="17" y1="1" x2="23" y2="7" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 3.07 9.81a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 2 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L6.91 8.27a16 16 0 0 0 6.29 6.29l1.63-1.34a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

/** Ảnh tròn nhỏ — TRA THEO userId ngay lúc hiển thị trong thư viện người dùng
 *  (cùng nguồn với danh sách hội thoại); thiếu nguồn → chữ viết tắt + màu. */
function MiniAvatar({
  id,
  name,
  size = 28,
  border,
}: {
  id?: number
  name: string
  size?: number
  border?: string
}) {
  const found = usePersonAvatar({ id })
  const label = found.name || name || "?"
  return (
    <Avatar
      src={found.avatar}
      name={label}
      sizePx={size}
      showPresence={false}
      ariaHidden
      className="font-semibold"
      style={{
        backgroundColor: colorForName(label),
        color: "#fff",
        ...(border ? { border: `2px solid ${border}` } : {}),
      }}
    />
  )
}

export interface CallEventCardProps {
  event: CallEvent
  /** true = chính người xem bắt đầu cuộc gọi (thẻ nằm bên phải). */
  mine: boolean
  peerName?: string
  /** id đối phương — ảnh tra theo id trong thư viện người dùng khi vẽ. */
  peerId?: number
  /** Giờ bắt đầu đã định dạng (HH:MM) — dùng lại hàm định dạng của khung chat. */
  timeLabel?: string
  /** "full" = thẻ đầy đủ; "pill" = dải viên thuốc một dòng cho cuộc gọi cũ. */
  variant?: "full" | "pill"
  /** Thời lượng đang chạy (giây) khi đang diễn ra. */
  liveSec?: number
  canJoin?: boolean
  onCallBack?: (media: CallMedia) => void
  onJoin?: () => void
}

export function CallEventCard({
  event,
  mine,
  peerName,
  peerId,
  timeLabel,
  variant = "full",
  liveSec,
  canJoin,
  onCallBack,
  onJoin,
}: CallEventCardProps) {
  const view = callEventView(event, mine ? "caller" : "callee", {
    liveSec,
    canJoin,
  })
  const tone = CALL_TONES[view.tone]
  const interactive = view.canCallBack && !!onCallBack
  const timeAlign = mine ? "right" : "left"

  const onKey = (e: KeyboardEvent) => {
    if (!interactive) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onCallBack?.(event.media)
    }
  }

  const iconArea = (
    <span
      className="rounded-full flex items-center justify-center flex-shrink-0 relative"
      style={{ width: 40, height: 40, backgroundColor: tone.iconBg, color: tone.iconFg }}
      aria-hidden
    >
      {view.isGroup && event.groupIds && event.groupIds.length > 0 ? (
        <span className="flex items-center">
          {event.groupIds.slice(0, 3).map((uid, i) => (
            <span key={uid} style={{ marginLeft: i === 0 ? 0 : -12 }}>
              <MiniAvatar
                id={uid}
                name={peerName ?? "?"}
                size={24}
                border={tone.iconBg}
              />
            </span>
          ))}
        </span>
      ) : (
        <CallGlyph icon={view.icon} color={tone.iconFg} />
      )}
    </span>
  )

  const titleEl = (
    <span
      className="text-sm font-semibold truncate"
      style={{ color: tone.titleColor }}
    >
      {view.isOngoing && (
        <span
          className="live-dot inline-block align-middle mr-1.5"
          style={{ width: 8, height: 8, backgroundColor: tone.dot }}
          aria-hidden
        />
      )}
      {view.title}
    </span>
  )

  const subtitleEl = view.subtitle ? (
    <span className="text-xs block truncate" style={{ color: "var(--muted)" }}>
      {view.subtitle}
    </span>
  ) : null

  const joinButton = view.showJoin ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onJoin?.()
      }}
      className="mt-2 px-3 py-1 rounded-full text-xs font-semibold transition-opacity hover:opacity-80"
      style={{ backgroundColor: "#22c55e", color: "#fff" }}
      aria-label={`Tham gia cuộc gọi ${event.media === "video" ? "video" : "thoại"}`}
    >
      Tham gia
    </button>
  ) : null

  const cardBody =
    variant === "pill" ? (
      <span
        className="px-3 py-1 rounded-full text-xs inline-flex items-center gap-1.5 max-w-[300px]"
        style={{
          backgroundColor: tone.bg,
          color: "var(--muted)",
          border: `1px solid ${tone.border}`,
        }}
      >
        <span style={{ color: tone.iconBg }} aria-hidden>
          <CallGlyph icon={view.icon} color={tone.iconBg} size={13} />
        </span>
        <span className="truncate">{callEventPillText(event)}</span>
      </span>
    ) : (
      <div
        className={`inline-flex items-start gap-2.5 px-3.5 py-3 rounded-2xl max-w-[300px] transition-shadow${
          interactive ? " cursor-pointer hover:shadow-md" : ""
        }`}
        style={{
          backgroundColor: tone.bg,
          border: `1px solid ${tone.border}`,
          borderRadius: 17,
        }}
      >
        {iconArea}
        <span className="min-w-0 flex flex-col">
          {titleEl}
          {subtitleEl}
          {joinButton}
        </span>
      </div>
    )

  const card = interactive ? (
    <div
      role="button"
      tabIndex={0}
      aria-label={view.ariaLabel}
      title={view.tooltip}
      onClick={() => onCallBack?.(event.media)}
      onKeyDown={onKey}
      className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
      style={{ borderRadius: 17 }}
    >
      {cardBody}
    </div>
  ) : (
    <div
      role="group"
      aria-label={view.ariaLabel}
      title={view.tooltip}
      style={{ borderRadius: 17 }}
    >
      {cardBody}
    </div>
  )

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start items-start gap-2"}`}>
      {!mine && (
        <MiniAvatar id={peerId} name={peerName ?? "?"} size={28} />
      )}
      <div className="max-w-[300px] min-w-0">
        {card}
        {timeLabel ? (
          <p
            className="text-xs mt-1 px-1"
            style={{ color: "var(--muted)", textAlign: timeAlign }}
          >
            {timeLabel}
          </p>
        ) : null}
      </div>
    </div>
  )
}
