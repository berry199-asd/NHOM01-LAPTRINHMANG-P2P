import React from "react"
import { Avatar } from "../../components/Avatar"
import type { Conversation, Message } from "../../types/chat"
import {
  previewLastMessage,
  callPreviewIcon,
  isMissedCallPreview,
  type PreviewMessage,
} from "../../lib/conversationPreview"
import { E2eUnlockPanel } from "../../components/E2eUnlockPanel"

export function lastMessageOf(conv: Conversation): Message | undefined {
  const visible = conv.messages.filter(
    (m) => m.decrypted !== false || m.undecryptable,
  )
  if (visible.length === 0) return undefined
  let best = visible[0]
  for (const m of visible) {
    if ((m.sentAt ?? 0) >= (best.sentAt ?? 0)) best = m
  }
  return best
}

// Tin cuối là cuộc gọi → dùng cho icon + màu đỏ ở dòng xem trước hội thoại.
export function lastCallOf(conv: Conversation) {
  const last = lastMessageOf(conv)
  return last?.kind === "call" ? last.call : undefined
}

// Tên người gửi ưu tiên biệt danh rồi tới danh sách thành viên của phòng.
export function senderNameResolver(
  conv: Conversation,
): (m: PreviewMessage) => string | undefined {
  return (m) => {
    const id = m.senderId
    if (id !== undefined) {
      const nick = conv.nicknames?.[id]
      if (nick) return nick
      const member = conv.members?.find((x) => x.id === id)
      if (member) return member.name
    }
    return m.senderName
  }
}

export interface ConversationSidebarProps {
  conversations: Conversation[]
  selectedId: number | undefined
  setSelectedId: (id: number) => void
  setRoomInfoOpen: (open: boolean) => void
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  search: string
  setSearch: (search: string) => void
  onOpenCreateRoom: () => void
  onOpenFindFriends: () => void
  meId: number
  e2eState?: "unlocked" | "locked" | "no_keystore" | "empty_passphrase" | "unlocking" | "error"
  onUnlock?: (passphrase: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number; lockoutSeconds?: number }>
  onLock?: () => void
  onOpenChangePassphrase?: () => void
  onResetKeystore?: () => void
}

export function ConversationSidebar({
  conversations,
  selectedId,
  setSelectedId,
  setRoomInfoOpen,
  setConversations,
  search,
  setSearch,
  onOpenCreateRoom,
  onOpenFindFriends,
  meId,
  e2eState = "unlocked",
  onUnlock = async () => ({ ok: false }),
  onLock = () => {},
  onOpenChangePassphrase = () => {},
  onResetKeystore,
}: ConversationSidebarProps) {
  const filtered = conversations
    .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (b.lastAt ?? 0) - (a.lastAt ?? 0)
    })

  return (
    <aside
      className="w-[332px] min-w-[300px] flex flex-col flex-shrink-0"
      style={{
        borderRight: "1px solid var(--border)",
        backgroundColor: "var(--bg)",
      }}
    >
      <div className="p-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--text)" }}
          >
            Tin nhắn
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenCreateRoom}
              className="h-7 px-2.5 rounded-full flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-70"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
              }}
              title="Tạo phòng"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              Tạo phòng
            </button>
            <button
              onClick={onOpenFindFriends}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-opacity hover:opacity-60"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
              }}
              title="Tìm bạn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--muted)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm hội thoại..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>
      </div>

      {/* Ô nhập mã mở khóa hoặc tạo mã E2E ngay dưới ô Tìm hội thoại */}
      {(e2eState === "locked" || e2eState === "no_keystore") && (
        <E2eUnlockPanel
          onUnlock={onUnlock}
          onOpenResetPassphrase={onOpenChangePassphrase}
          onResetKeystore={onResetKeystore}
          isLocked={true}
          isNewKeystore={e2eState === "no_keystore"}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.map((conv) => {
          const lastCall = lastCallOf(conv)
          const missedCall = isMissedCallPreview(lastCall)
          const previewIcon = callPreviewIcon(lastCall)
          return (
            <button
              key={conv.id}
              onClick={() => {
                setSelectedId(conv.id)
                setRoomInfoOpen(false)
                if (conv.unread) {
                  setConversations((prev) =>
                    prev.map((c) =>
                      c.id === conv.id ? { ...c, unread: 0 } : c,
                    ),
                  )
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
              style={{
                backgroundColor:
                  conv.id === selectedId ? "var(--surface)" : "transparent",
              }}
            >
              <Avatar
                initials={conv.initials}
                online={conv.online}
                src={conv.avatar}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span
                    className={`text-sm truncate flex items-center gap-1 ${
                      conv.unread ? "font-semibold" : "font-medium"
                    }`}
                    style={{ color: "var(--text)" }}
                  >
                    <span className="truncate">{conv.name}</span>
                    {conv.pinned && (
                      <span className="text-[10px] flex-shrink-0 opacity-70" title="Đã ghim">📌</span>
                    )}
                  </span>
                  <span
                    className="text-xs flex-shrink-0 ml-2 flex items-center gap-1.5"
                    style={{ color: "var(--muted)" }}
                  >
                    {conv.time}
                    {!!conv.unread && conv.unread > 0 && (
                      <span
                        className={
                          conv.unread > 1
                            ? "min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-semibold"
                            : "w-2.5 h-2.5 rounded-full"
                        }
                        style={{
                          backgroundColor: "#3b82f6",
                          color: "#fff",
                        }}
                      >
                        {conv.unread > 1 ? conv.unread : ""}
                      </span>
                    )}
                  </span>
                </div>
                <p
                  className={`text-xs truncate ${
                    conv.unread ? "font-semibold" : ""
                  }`}
                  style={{
                    color: missedCall
                      ? "var(--error)"
                      : conv.unread
                        ? "var(--text)"
                        : "var(--muted)",
                  }}
                >
                  {previewIcon ? `${previewIcon} ` : ""}
                  {previewLastMessage(
                    lastMessageOf(conv),
                    meId,
                    senderNameResolver(conv),
                  )}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Chip trạng thái E2E dưới đáy Sidebar */}
      <div
        className="p-2.5 px-3 border-t flex items-center justify-between text-[11px] flex-shrink-0"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              e2eState === "unlocked" ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
            }`}
          />
          <span className="font-medium" style={{ color: "var(--text)" }}>
            {e2eState === "unlocked"
              ? "E2E: Đã mở khóa"
              : e2eState === "no_keystore"
              ? "E2E: Chưa thiết lập"
              : "E2E: Chưa mở khóa"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {e2eState === "unlocked" && (
            <button
              type="button"
              onClick={onLock}
              className="text-[11px] opacity-70 hover:opacity-100 hover:underline transition-opacity"
              style={{ color: "var(--muted)" }}
              title="Khóa ngay để xóa khóa E2E khỏi bộ nhớ tạm"
            >
              Khóa ngay
            </button>
          )}
          <button
            type="button"
            onClick={onOpenChangePassphrase}
            className="text-[11px] opacity-80 hover:opacity-100 hover:underline font-medium transition-opacity"
            style={{ color: "var(--primary)" }}
          >
            Đổi mã
          </button>
        </div>
      </div>
    </aside>
  )
}
