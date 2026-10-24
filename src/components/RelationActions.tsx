import { useState } from "react"
import { api, type Relation } from "../lib/api"

export function friendActionError(error: string | null | undefined): string {
  return error === "already_friends"
    ? "Đã là bạn bè từ trước"
    : error === "already_pending"
      ? "Bạn đã gửi lời mời rồi"
      : error === "already_responded"
        ? "Lời mời đã được xử lý"
        : error === "not_found"
          ? "Không tìm thấy người dùng này"
          : "Thao tác thất bại, thử lại sau"
}

interface Props {
  relation: Relation
  publicId?: string
  requestId?: number
  onChange: (rel: Relation, requestId?: number) => void
  onError?: (error: string) => void
  size?: "sm" | "md"
}

/**
 * Bộ nút thao tác theo quan hệ bạn bè, dùng chung cho FindFriendsModal và ProfilePanel.
 * Tự gọi API và thông báo kết quả qua onChange/onError.
 */
export function RelationActions({
  relation,
  publicId,
  requestId,
  onChange,
  onError,
  size = "sm",
}: Props) {
  const [busy, setBusy] = useState(false)
  const pad = size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"
  const padMini = size === "md" ? "px-3 py-2 text-sm" : "px-2.5 py-1 text-xs"
  const chip =
    "flex-shrink-0 font-medium rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"

  const fail = (err: string | null | undefined) => onError?.(friendActionError(err))

  const runRequest = async () => {
    if (!publicId || busy) return
    setBusy(true)
    const r = await api.requestFriend(publicId)
    setBusy(false)
    if (!r.ok) return fail(r.error)
    onChange(
      r.data?.outcome === "accepted" ? "friend" : "pending_sent",
      r.data?.request_id,
    )
  }

  const runCancel = async () => {
    if (!requestId || busy) return
    setBusy(true)
    const r = await api.cancelFriend(requestId)
    setBusy(false)
    if (!r.ok) return fail(r.error)
    onChange("none")
  }

  const runAccept = async () => {
    if (!requestId || busy) return
    setBusy(true)
    const r = await api.acceptFriend(requestId)
    setBusy(false)
    if (!r.ok) return fail(r.error)
    onChange("friend")
  }

  const runReject = async () => {
    if (!requestId || busy) return
    setBusy(true)
    const r = await api.rejectFriend(requestId)
    setBusy(false)
    if (!r.ok) return fail(r.error)
    onChange("none")
  }

  if (relation === "none") {
    return (
      <button
        onClick={runRequest}
        disabled={busy || !publicId}
        className={`${chip} ${pad} font-semibold`}
        style={{ backgroundColor: "var(--primary)", color: "var(--primary-fg)" }}
      >
        Kết bạn
      </button>
    )
  }

  if (relation === "pending_sent") {
    return (
      <div className="flex-shrink-0 flex items-center gap-2">
        <span
          className={`${padMini} font-medium rounded-md`}
          style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          Đã gửi lời mời
        </span>
        {requestId && (
          <button
            onClick={runCancel}
            disabled={busy}
            className={`${chip} ${padMini} border`}
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            Hủy
          </button>
        )}
      </div>
    )
  }

  if (relation === "pending_received" && requestId) {
    return (
      <div className="flex-shrink-0 flex items-center gap-2">
        <button
          onClick={runAccept}
          disabled={busy}
          className={`${chip} ${padMini} font-semibold`}
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-fg)" }}
        >
          Chấp nhận
        </button>
        <button
          onClick={runReject}
          disabled={busy}
          className={`${chip} ${padMini} border`}
          style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
        >
          Từ chối
        </button>
      </div>
    )
  }

  if (relation === "friend") {
    return (
      <span
        className={`${chip} ${pad} font-semibold`}
        style={{
          border: "1px solid var(--primary)",
          color: "var(--primary)",
          backgroundColor: "transparent",
        }}
      >
        Bạn bè
      </span>
    )
  }

  if (relation === "self") {
    return (
      <span
        className={`${chip} ${pad} font-semibold`}
        style={{
          border: "1px solid var(--primary)",
          color: "var(--primary)",
          backgroundColor: "transparent",
        }}
      >
        Bạn
      </span>
    )
  }

  return null
}
