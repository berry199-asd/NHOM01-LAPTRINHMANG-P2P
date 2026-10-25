import React from "react"
import { Avatar } from "../../components/Avatar"
import { AvatarStack } from "../../components/AvatarStack"
import { presenceColor, presenceText } from "../../lib/presenceLabel"
import type { CallKind } from "../../lib/peer"
import type { Conversation } from "../../types/chat"

export interface ChatHeaderProps {
  selected: Conversation
  selectedTransport?: string
  meId: number
  searchOpen: boolean
  searchQuery: string
  searchIdx: number
  computeSearch: (q: string) => number[]
  focusSearchResult: (id: number) => void
  setSearchQuery: (q: string) => void
  setSearchIdx: React.Dispatch<React.SetStateAction<number>>
  setSearchCurId: (id: number | null) => void
  jumpToSearch: (dir: 1 | -1) => void
  closeSearch: () => void
  openSearch: () => void
  openOtherProfile: (data: {
    name: string
    initials: string
    publicId?: string
    online: boolean
  }) => void
  startCall: (kind: CallKind) => void
  callBusy: boolean
  roomInfoOpen: boolean
  setRoomInfoOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function ChatHeader({
  selected,
  selectedTransport,
  meId,
  searchOpen,
  searchQuery,
  searchIdx,
  computeSearch,
  focusSearchResult,
  setSearchQuery,
  setSearchIdx,
  setSearchCurId,
  jumpToSearch,
  closeSearch,
  openSearch,
  openOtherProfile,
  startCall,
  callBusy,
  roomInfoOpen,
  setRoomInfoOpen,
}: ChatHeaderProps) {
  return (
    <div
      className="relative flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {searchOpen &&
        (() => {
          const results = computeSearch(searchQuery)
          const total = results.length
          const idx = total > 0 ? Math.min(searchIdx, total - 1) : 0
          return (
            <div
              className="absolute inset-0 z-10 px-4 flex items-center gap-2"
              style={{ backgroundColor: "var(--bg)" }}
              onClick={(e) => e.stopPropagation()}
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
                style={{ color: "var(--muted)", flexShrink: 0 }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setSearchIdx(0)
                  setSearchCurId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (results.length > 0) {
                      focusSearchResult(results[idx])
                      setSearchIdx(idx)
                    }
                  }
                  if (e.key === "Escape") closeSearch()
                }}
                placeholder="Tìm kiếm trong hội thoại..."
                className="flex-1 px-3 py-1.5 text-sm rounded-md outline-none min-w-0"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
              <button
                onClick={() => jumpToSearch(-1)}
                className="p-1.5 rounded-md transition-opacity hover:opacity-60 flex-shrink-0"
                style={{ color: "var(--muted)" }}
                title="Kết quả trước (Shift+Enter)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                onClick={() => jumpToSearch(1)}
                className="p-1.5 rounded-md transition-opacity hover:opacity-60 flex-shrink-0"
                style={{ color: "var(--muted)" }}
                title="Kết quả sau (Enter)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              <span
                className="text-xs tabular-nums flex-shrink-0"
                style={{
                  color: total > 0 ? "var(--text)" : "var(--error)",
                }}
              >
                {idx + 1}/{total}
              </span>
              <button
                onClick={closeSearch}
                className="p-1.5 rounded-md transition-opacity hover:opacity-60 flex-shrink-0"
                style={{ color: "var(--muted)" }}
                title="Đóng tìm kiếm (Esc)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )
        })()}
      <div
        className={
          selected.isGroup
            ? "flex items-center gap-3"
            : "flex items-center gap-3 cursor-pointer rounded-md hover:opacity-90 transition-opacity"
        }
        role={selected.isGroup ? undefined : "button"}
        onClick={
          selected.isGroup
            ? undefined
            : () =>
                openOtherProfile({
                  name: selected.name,
                  initials: selected.initials,
                  publicId: selected.members?.find((m) => m.id !== meId)
                    ?.publicId,
                  online:
                    selected.members?.find((m) => m.id !== meId)?.online ??
                    false,
                })
        }
      >
        {selected.isGroup ? (
          selected.avatar ? (
            <Avatar
              src={selected.avatar}
              name={selected.name}
              initials={selected.initials}
              showPresence={false}
            />
          ) : (
            <AvatarStack members={selected.members ?? []} />
          )
        ) : (
          <Avatar
            src={selected.avatar}
            initials={selected.initials}
            online={selected.online}
          />
        )}
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            {selected.name}
          </p>
          <p
            className="text-xs"
            style={{
              color: selected.isGroup
                ? "var(--muted)"
                : presenceColor(selected.online),
            }}
          >
            {selected.isGroup
              ? `${selected.members?.length ?? 0} thành viên`
              : presenceText(selected.online)}
          </p>
          {selectedTransport && (
            <span
              className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
              style={{
                backgroundColor:
                  selectedTransport === "udp"
                    ? "rgba(34,197,94,0.15)"
                    : selectedTransport === "relay"
                      ? "rgba(245,158,11,0.15)"
                      : "rgba(59,130,246,0.15)",
                color:
                  selectedTransport === "udp"
                    ? "#22c55e"
                    : selectedTransport === "relay"
                      ? "#f59e0b"
                      : "#3b82f6",
              }}
              title="Kênh truyền P2P đang dùng cho hội thoại này"
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor:
                    selectedTransport === "udp"
                      ? "#22c55e"
                      : selectedTransport === "relay"
                        ? "#f59e0b"
                        : "#3b82f6",
                }}
              />
              {selectedTransport === "udp"
                ? "UDP P2P"
                : selectedTransport === "relay"
                  ? "Relay"
                  : "P2P (TCP)"}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={openSearch}
          className="p-2 rounded-md transition-opacity hover:opacity-60"
          style={{ color: "var(--muted)" }}
          title="Tìm kiếm trong hội thoại"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button
          onClick={() => void startCall("voice")}
          disabled={callBusy}
          className="p-2 rounded-md transition-opacity hover:opacity-60 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: "var(--muted)" }}
          title={callBusy ? "Đang có cuộc gọi" : "Gọi thoại"}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.27a16 16 0 006.29 6.29l1.63-1.34a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
          </svg>
        </button>
        <button
          onClick={() => void startCall("video")}
          disabled={callBusy}
          className="p-2 rounded-md transition-opacity hover:opacity-60 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: "var(--muted)" }}
          title={callBusy ? "Đang có cuộc gọi" : "Gọi video"}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
        </button>
        <button
          onClick={() => setRoomInfoOpen((v) => !v)}
          className="p-2 rounded-md transition-opacity hover:opacity-60"
          style={{
            color: roomInfoOpen ? "var(--text)" : "var(--muted)",
          }}
          title="Thông tin đoạn chat"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </button>
      </div>
    </div>
  )
}
