import React, { useState, useRef, useEffect } from "react"
import { resolveAvatarUrl } from "../../lib/avatarUrl"
import { initialsOf } from "../../lib/callView"

export interface FriendCardData {
  id?: number
  publicId: string
  displayName: string
  username?: string
  avatarUrl?: string
  online?: boolean
  mutualCount?: number
  sharedRooms?: number
  subtitle?: string
  requestId?: number
  createdAt?: number
  bio?: string
  coverUrl?: string
}

export type FriendCardContext =
  | "requests"
  | "sent"
  | "suggestions"
  | "all"
  | "blocked"

export interface FriendCardProps {
  user: FriendCardData
  context: FriendCardContext
  onConfirm?: (user: FriendCardData) => Promise<void> | void
  onReject?: (user: FriendCardData) => Promise<void> | void
  onCancelRequest?: (user: FriendCardData) => Promise<void> | void
  onAddFriend?: (user: FriendCardData) => Promise<void> | void
  onRemoveSuggestion?: (user: FriendCardData) => void
  onMessage?: (user: FriendCardData) => void
  onCall?: (user: FriendCardData) => void
  onUnfriend?: (user: FriendCardData) => Promise<void> | void
  onBlock?: (user: FriendCardData) => Promise<void> | void
  onUnblock?: (user: FriendCardData) => Promise<void> | void
  onClickCard?: (user: FriendCardData) => void
}

export function FriendCard({
  user,
  context,
  onConfirm,
  onReject,
  onCancelRequest,
  onAddFriend,
  onRemoveSuggestion,
  onMessage,
  onCall,
  onUnfriend,
  onBlock,
  onUnblock,
  onClickCard,
}: FriendCardProps) {
  const [imgError, setImgError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<"unfriend" | "block" | null>(null)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const resolvedAvatar = resolveAvatarUrl(user.avatarUrl)

  useEffect(() => {
    setImgError(false)
  }, [resolvedAvatar])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [menuOpen])

  const initials = initialsOf(user.displayName || user.username || "?")

  const getSubtitle = () => {
    if (user.subtitle) return user.subtitle
    if (user.mutualCount && user.mutualCount > 0) {
      return `${user.mutualCount} bạn chung`
    }
    if (user.sharedRooms && user.sharedRooms > 0) {
      return `${user.sharedRooms} nhóm chung`
    }
    if (user.online) {
      return "Đang hoạt động"
    }
    if (user.username) {
      return `@${user.username}`
    }
    if (context === "all") return "Bạn bè"
    if (context === "requests") return "Đã gửi lời mời"
    if (context === "sent") return "Đang chờ phản hồi"
    if (context === "blocked") return "Đã chặn"
    return "Gợi ý cho bạn"
  }

  const handleAction = async (
    e: React.MouseEvent,
    fn?: (user: FriendCardData) => Promise<void> | void,
  ) => {
    e.stopPropagation()
    if (!fn || busy) return
    setBusy(true)
    try {
      await fn(user)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div
        role="article"
        tabIndex={0}
        aria-label={`Thẻ người dùng: ${user.displayName}`}
        onClick={() => onClickCard && onClickCard(user)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClickCard && onClickCard(user)
          }
        }}
        className="group relative flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all duration-150 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        {/* Top Square Avatar Container */}
        <div
          className="relative aspect-square w-full overflow-hidden flex items-center justify-center select-none"
          style={{ backgroundColor: "var(--bg)" }}
        >
          {resolvedAvatar && !imgError ? (
            <img
              src={resolvedAvatar}
              alt=""
              aria-hidden="true"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center font-bold text-3xl select-none tracking-wider"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--text)",
              }}
              aria-hidden="true"
            >
              {initials}
            </div>
          )}

          {/* Online presence badge */}
          {user.online && (
            <span
              title="Đang hoạt động"
              className="absolute bottom-2 right-2 w-3.5 h-3.5 rounded-full border-2"
              style={{
                backgroundColor: "#22c55e",
                borderColor: "var(--surface)",
              }}
              aria-label="Đang hoạt động"
            />
          )}

          {/* Context menu for Friends tab */}
          {context === "all" && (
            <div className="absolute top-2 right-2" ref={menuRef}>
              <button
                type="button"
                aria-label="Tùy chọn khác"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((v) => !v)
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center shadow transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                style={{
                  backgroundColor: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="19" cy="12" r="2" />
                  <circle cx="5" cy="12" r="2" />
                </svg>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 w-40 rounded-lg shadow-lg py-1 z-20"
                  style={{
                    backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      setConfirmDialog("unfriend")
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium hover:opacity-80 transition-colors flex items-center gap-2"
                    style={{ color: "#ef4444" }}
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
                      aria-hidden="true"
                    >
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <line x1="17" y1="8" x2="23" y2="14" />
                      <line x1="23" y1="8" x2="17" y2="14" />
                    </svg>
                    Hủy kết bạn
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      setConfirmDialog("block")
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium hover:opacity-80 transition-colors flex items-center gap-2"
                    style={{ color: "#ef4444" }}
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
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                    Chặn
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Card Body */}
        <div className="flex flex-col flex-1 p-3 justify-between gap-2.5">
          <div className="min-w-0">
            <h3
              className="text-sm font-semibold truncate leading-snug"
              style={{ color: "var(--text)" }}
              title={user.displayName}
            >
              {user.displayName}
            </h3>
            <p
              className="text-xs truncate mt-0.5"
              style={{
                color: user.online ? "#22c55e" : "var(--muted)",
                fontWeight: user.online ? 500 : 400,
              }}
              title={getSubtitle()}
            >
              {getSubtitle()}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-1.5 pt-0.5">
            {context === "requests" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => handleAction(e, onConfirm)}
                  className="w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50 text-white"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  Xác nhận
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => handleAction(e, onReject)}
                  className="w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Xóa
                </button>
              </>
            )}

            {context === "sent" && (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => handleAction(e, onCancelRequest)}
                className="w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Hủy lời mời
              </button>
            )}

            {context === "suggestions" && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => handleAction(e, onAddFriend)}
                  className="w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50 text-white"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  Thêm bạn
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveSuggestion && onRemoveSuggestion(user)
                  }}
                  className="w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Gỡ
                </button>
              </>
            )}

            {context === "all" && (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMessage && onMessage(user)
                  }}
                  className="flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50 text-white flex items-center justify-center gap-1"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Nhắn tin
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCall && onCall(user)
                  }}
                  className="py-1.5 px-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center justify-center"
                  style={{
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                  title="Gọi thoại hoặc video"
                  aria-label="Gọi"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </button>
              </div>
            )}

            {context === "blocked" && (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => handleAction(e, onUnblock)}
                className="w-full py-1.5 px-3 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Bỏ chặn
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Unfriend or Block */}
      {confirmDialog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            e.stopPropagation()
            setConfirmDialog(null)
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-2xl flex flex-col gap-3"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="confirm-dialog-title" className="text-sm font-bold">
              {confirmDialog === "unfriend"
                ? `Hủy kết bạn với ${user.displayName}?`
                : `Chặn người dùng ${user.displayName}?`}
            </h4>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {confirmDialog === "unfriend"
                ? `Bạn có chắc chắn muốn hủy kết bạn với ${user.displayName}? Hai bạn sẽ không còn trong danh sách bạn bè của nhau.`
                : `${user.displayName} sẽ không thể nhắn tin, gọi điện hoặc tìm thấy bạn trên WorkChat.`}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation()
                  const mode = confirmDialog
                  setConfirmDialog(null)
                  if (mode === "unfriend") {
                    await handleAction(e, onUnfriend)
                  } else {
                    await handleAction(e, onBlock)
                  }
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#ef4444" }}
              >
                {confirmDialog === "unfriend" ? "Xác nhận hủy" : "Xác nhận chặn"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
