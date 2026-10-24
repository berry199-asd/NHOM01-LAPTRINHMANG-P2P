import React, { useEffect, useState } from "react"
import { resolveAvatarUrl } from "../../lib/avatarUrl"
import { initialsOf } from "../../lib/callView"
import type { FriendCardData, FriendCardContext } from "./FriendCard"

export interface MiniProfileModalProps {
  user: FriendCardData | null
  context: FriendCardContext
  onClose: () => void
  onConfirm?: (user: FriendCardData) => Promise<void> | void
  onReject?: (user: FriendCardData) => Promise<void> | void
  onCancelRequest?: (user: FriendCardData) => Promise<void> | void
  onAddFriend?: (user: FriendCardData) => Promise<void> | void
  onMessage?: (user: FriendCardData) => void
  onCall?: (user: FriendCardData) => void
  onUnfriend?: (user: FriendCardData) => Promise<void> | void
  onBlock?: (user: FriendCardData) => Promise<void> | void
  onUnblock?: (user: FriendCardData) => Promise<void> | void
}

export function MiniProfileModal({
  user,
  context,
  onClose,
  onConfirm,
  onReject,
  onCancelRequest,
  onAddFriend,
  onMessage,
  onCall,
  onUnfriend,
  onBlock,
  onUnblock,
}: MiniProfileModalProps) {
  const [imgError, setImgError] = useState(false)
  const [coverError, setCoverError] = useState(false)

  // Đóng modal khi nhấn Esc (bắt sự kiện trước trang cha)
  useEffect(() => {
    if (!user) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true })
    }
  }, [user, onClose])

  if (!user) return null

  const resolvedAvatar = resolveAvatarUrl(user.avatarUrl)
  const resolvedCover = resolveAvatarUrl(user.coverUrl)
  const initials = initialsOf(user.displayName || user.username || "?")

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mini-profile-name"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col relative animate-in fade-in zoom-in-95 duration-150"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nút đóng X ở góc trên modal */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng hồ sơ"
          className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
          style={{
            backgroundColor: "rgba(0,0,0,0.5)",
            color: "#ffffff",
          }}
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
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Cover banner */}
        <div
          className="h-28 w-full relative overflow-hidden"
          style={{
            backgroundColor: "var(--bg)",
            backgroundImage:
              resolvedCover && !coverError
                ? `url(${resolvedCover})`
                : "linear-gradient(135deg, var(--primary) 0%, #3b82f6 100%)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {resolvedCover && !coverError && (
            <img
              src={resolvedCover}
              alt=""
              className="hidden"
              onError={() => setCoverError(true)}
            />
          )}
        </div>

        {/* Avatar & Header */}
        <div className="px-5 pb-5 pt-0 flex flex-col relative">
          <div className="-mt-12 mb-3 flex items-end justify-between">
            <div className="relative">
              <div
                className="w-20 h-20 rounded-full border-4 overflow-hidden flex items-center justify-center font-bold text-2xl shadow-md select-none"
                style={{
                  backgroundColor: "var(--bg)",
                  borderColor: "var(--surface)",
                  color: "var(--text)",
                }}
              >
                {resolvedAvatar && !imgError ? (
                  <img
                    src={resolvedAvatar}
                    alt=""
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              {user.online && (
                <span
                  title="Đang hoạt động"
                  className="absolute bottom-1 right-1 w-4 h-4 rounded-full border-2"
                  style={{
                    backgroundColor: "#22c55e",
                    borderColor: "var(--surface)",
                  }}
                />
              )}
            </div>

            {/* Trạng thái hoạt động */}
            <div className="text-right pb-1">
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  backgroundColor: user.online ? "#dcfce7" : "var(--bg)",
                  color: user.online ? "#15803d" : "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                {user.online ? "Đang hoạt động" : "Ngoại tuyến"}
              </span>
            </div>
          </div>

          {/* User Details */}
          <h3
            id="mini-profile-name"
            className="text-lg font-bold leading-tight"
            style={{ color: "var(--text)" }}
          >
            {user.displayName}
          </h3>
          {user.username && (
            <p className="text-xs font-mono mt-0.5" style={{ color: "var(--muted)" }}>
              @{user.username}
            </p>
          )}

          {/* Bio nếu có */}
          {user.bio && (
            <p
              className="text-xs mt-2 p-2.5 rounded-lg"
              style={{
                backgroundColor: "var(--bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
            >
              {user.bio}
            </p>
          )}

          {/* Thống kê bạn chung / phòng chung */}
          <div className="flex flex-wrap gap-3 mt-3 text-xs" style={{ color: "var(--muted)" }}>
            {user.mutualCount !== undefined && user.mutualCount > 0 && (
              <span className="flex items-center gap-1">
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
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                {user.mutualCount} bạn chung
              </span>
            )}
            {user.sharedRooms !== undefined && user.sharedRooms > 0 && (
              <span className="flex items-center gap-1">
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
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                {user.sharedRooms} nhóm chung
              </span>
            )}
          </div>

          {/* Action Row */}
          <div className="flex gap-2 mt-5 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            {context === "all" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onMessage && onMessage(user)
                  }}
                  className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: "var(--primary)" }}
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
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Nhắn tin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    onCall && onCall(user)
                  }}
                  className="py-2 px-3 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80 flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
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
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  Gọi điện
                </button>
              </>
            )}

            {context === "requests" && (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    onClose()
                    onConfirm && (await onConfirm(user))
                  }}
                  className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  Xác nhận kết bạn
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    onClose()
                    onReject && (await onReject(user))
                  }}
                  className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: "var(--bg)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Xóa yêu cầu
                </button>
              </>
            )}

            {context === "sent" && (
              <button
                type="button"
                onClick={async () => {
                  onClose()
                  onCancelRequest && (await onCancelRequest(user))
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Hủy lời mời kết bạn
              </button>
            )}

            {context === "suggestions" && (
              <button
                type="button"
                onClick={async () => {
                  onClose()
                  onAddFriend && (await onAddFriend(user))
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "var(--primary)" }}
              >
                Thêm bạn bè
              </button>
            )}

            {context === "blocked" && (
              <button
                type="button"
                onClick={async () => {
                  onClose()
                  onUnblock && (await onUnblock(user))
                }}
                className="w-full py-2 px-3 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--bg)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Bỏ chặn người dùng này
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
