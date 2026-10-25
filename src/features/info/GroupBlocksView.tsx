import { useState, useEffect } from "react"
import { Avatar } from "../../components/Avatar"
import { initialsOf } from "../chat/bubbles/VoiceBubble"
import { api } from "../../lib/api"
import type { RoomBlock } from "../../types/chat"

function timeAgo(ms: number): string {
  if (!ms) return "vừa xong"
  const diff = Math.max(0, Date.now() - ms)
  if (diff < 60_000) return "vừa xong"
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} phút trước`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} giờ trước`
  const days = Math.floor(hours / 24)
  return `${days} ngày trước`
}

export function GroupBlocksView({
  roomId,
  onBack,
  onPushToast,
}: {
  roomId: number
  onBack: () => void
  onPushToast: (msg: string) => void
}) {
  const [blocks, setBlocks] = useState<RoomBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unblockingId, setUnblockingId] = useState<number | null>(null)

  const loadBlocks = async () => {
    setLoading(true)
    setError(null)
    const res = await api.getRoomBlocks(roomId)
    setLoading(false)
    if (!res.ok || !res.data) {
      setError(res.error || "Không thể tải danh sách chặn")
      return
    }
    setBlocks(res.data.blocks || [])
  }

  useEffect(() => {
    void loadBlocks()
  }, [roomId])

  const handleUnblock = async (b: RoomBlock) => {
    if (unblockingId !== null) return
    setUnblockingId(b.user_id)
    const res = await api.unblockRoomMember(roomId, b.user_id)
    setUnblockingId(null)

    if (!res.ok) {
      onPushToast("Không thể bỏ chặn: " + (res.error || "Lỗi"))
      return
    }

    onPushToast(`Đã bỏ chặn ${b.display_name}`)
    setBlocks((prev) => prev.filter((x) => x.user_id !== b.user_id))
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--bg)" }}>
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded-md transition-opacity hover:opacity-70 focus:outline-none focus:ring-1"
            style={{ color: "var(--text)" }}
            aria-label="Quay lại Quản lý nhóm"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <h2 className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
            Chặn khỏi nhóm {blocks.length > 0 && `(${blocks.length})`}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="p-3 rounded-xl animate-pulse flex items-center gap-3"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  className="w-10 h-10 rounded-full flex-shrink-0"
                  style={{ backgroundColor: "var(--border)" }}
                />
                <div className="flex-1 min-w-0 space-y-2">
                  <div
                    className="h-3.5 rounded w-1/3"
                    style={{ backgroundColor: "var(--border)" }}
                  />
                  <div
                    className="h-2.5 rounded w-2/3"
                    style={{ backgroundColor: "var(--border)" }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <p className="text-sm" style={{ color: "var(--error)" }}>
              {error}
            </p>
            <button
              onClick={() => void loadBlocks()}
              className="px-3 py-1.5 text-xs font-semibold rounded-md"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
              }}
            >
              Thử lại
            </button>
          </div>
        ) : blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-1"
              style={{ backgroundColor: "var(--surface)", color: "var(--muted)" }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Danh sách chặn trống
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Các thành viên bị chặn sẽ không thể tham gia hoặc gửi tin nhắn vào nhóm
            </p>
          </div>
        ) : (
          blocks.map((b) => {
            const isUnblocking = unblockingId === b.user_id
            return (
              <div
                key={b.id}
                className="p-3.5 rounded-xl flex items-center justify-between gap-3"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    sizePx={40}
                    src={b.avatar}
                    name={b.display_name}
                    initials={initialsOf(b.display_name)}
                    showPresence={false}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                      {b.display_name}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                      Chặn bởi {b.blocker_name || "Quản trị viên"} • {timeAgo(b.blocked_at)}
                    </p>
                    {b.reason && (
                      <p className="text-xs italic truncate mt-0.5" style={{ color: "var(--muted)" }}>
                        Lý do: {b.reason}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  disabled={isUnblocking}
                  onClick={() => void handleUnblock(b)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50 flex-shrink-0"
                  style={{
                    backgroundColor: "transparent",
                    color: "var(--primary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {isUnblocking ? "Đang xử lý..." : "Bỏ chặn"}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
