import { useState, useEffect } from "react"
import { Avatar } from "../../components/Avatar"
import { initialsOf } from "../chat/bubbles/VoiceBubble"
import { api } from "../../lib/api"
import type { JoinRequest } from "../../types/chat"

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

export function GroupJoinRequestsView({
  roomId,
  onBack,
  onPushToast,
  onRefreshRoom,
}: {
  roomId: number
  onBack: () => void
  onPushToast: (msg: string) => void
  onRefreshRoom?: () => void
}) {
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [confirmApproveAll, setConfirmApproveAll] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)

  const loadRequests = async () => {
    setLoading(true)
    setError(null)
    const res = await api.getRoomJoinRequests(roomId)
    setLoading(false)
    if (!res.ok || !res.data) {
      setError(res.error || "Không thể tải danh sách yêu cầu")
      return
    }
    setRequests(res.data.requests || [])
  }

  useEffect(() => {
    void loadRequests()
  }, [roomId])

  const handleDecide = async (req: JoinRequest, action: "approve" | "reject") => {
    if (processingId !== null) return
    setProcessingId(req.id)
    const res = await api.decideRoomJoinRequest(roomId, req.id, action)
    setProcessingId(null)

    if (!res.ok) {
      onPushToast(
        res.error === "forbidden_member_blocked"
          ? "Người này đã bị chặn khỏi nhóm"
          : `Không thể ${action === "approve" ? "duyệt" : "từ chối"}: ${res.error || "Lỗi"}`,
      )
      return
    }

    if (res.data?.already_decided) {
      onPushToast("Yêu cầu này đã được quản trị viên khác xử lý")
    } else {
      onPushToast(
        action === "approve"
          ? `Đã duyệt ${req.display_name} vào nhóm`
          : `Đã từ chối yêu cầu của ${req.display_name}`,
      )
    }

    setRequests((prev) => prev.filter((r) => r.id !== req.id))
    onRefreshRoom?.()
  }

  const handleApproveAll = async () => {
    if (approvingAll || requests.length === 0) return
    setApprovingAll(true)
    const res = await api.approveAllRoomJoinRequests(roomId)
    setApprovingAll(false)
    setConfirmApproveAll(false)

    if (!res.ok) {
      onPushToast("Không thể duyệt tất cả: " + (res.error || "Lỗi"))
      return
    }

    onPushToast(`Đã duyệt thành công ${res.data?.approved_count ?? 0} yêu cầu`)
    setRequests([])
    onRefreshRoom?.()
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
            Duyệt thành viên {requests.length > 0 && `(${requests.length})`}
          </h2>
        </div>

        {requests.length > 0 && !loading && (
          <button
            onClick={() => setConfirmApproveAll(true)}
            className="px-2.5 py-1 text-xs font-semibold rounded-md transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--surface)",
              color: "var(--primary)",
              border: "1px solid var(--border)",
            }}
          >
            Duyệt tất cả
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {loading ? (
          // Skeleton loader
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
              onClick={() => void loadRequests()}
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
        ) : requests.length === 0 ? (
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
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <polyline points="16 11 18 13 22 9" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Không có yêu cầu nào
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Tất cả thành viên mới đều đã được duyệt
            </p>
          </div>
        ) : (
          requests.map((r) => {
            const isProcessing = processingId === r.id
            const viaText =
              r.via === "link"
                ? "Qua link tham gia"
                : r.inviter_name
                  ? `Mời bởi ${r.inviter_name}`
                  : "Được mời"
            return (
              <div
                key={r.id}
                className="p-3.5 rounded-xl flex flex-col gap-3 transition-shadow"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    sizePx={40}
                    src={r.avatar}
                    name={r.display_name}
                    initials={initialsOf(r.display_name)}
                    showPresence={false}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                      {r.display_name}
                    </p>
                    <p className="text-xs truncate flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                      <span>{viaText}</span>
                      <span>•</span>
                      <span>{timeAgo(r.created_at)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
                  <button
                    disabled={isProcessing}
                    onClick={() => void handleDecide(r, "reject")}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{
                      backgroundColor: "transparent",
                      color: "var(--muted)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Từ chối
                  </button>
                  <button
                    disabled={isProcessing}
                    onClick={() => void handleDecide(r, "approve")}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-fg)",
                    }}
                  >
                    {isProcessing ? "Đang xử lý..." : "Duyệt"}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Approve All Confirmation Modal */}
      {confirmApproveAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              Duyệt tất cả yêu cầu?
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              Tất cả <strong>{requests.length}</strong> người đang chờ sẽ được thêm vào nhóm ngay lập tức.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                disabled={approvingAll}
                onClick={() => setConfirmApproveAll(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg"
                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Hủy
              </button>
              <button
                disabled={approvingAll}
                onClick={() => void handleApproveAll()}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                }}
              >
                {approvingAll ? "Đang duyệt..." : "Xác nhận duyệt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
