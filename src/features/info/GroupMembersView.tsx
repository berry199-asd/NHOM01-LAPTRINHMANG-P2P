import { useState } from "react"
import { Avatar } from "../../components/Avatar"
import { initialsOf } from "../chat/bubbles/VoiceBubble"
import { api } from "../../lib/api"
import type { Conversation, RoomMember } from "../../types/chat"

export function GroupMembersView({
  conv,
  myMemberId,
  friendCandidates,
  onBack,
  onPushToast,
  onRefreshRoom,
  onViewMember,
  onAddMembers,
}: {
  conv: Conversation
  myMemberId?: number
  friendCandidates: RoomMember[]
  onBack: () => void
  onPushToast: (msg: string) => void
  onRefreshRoom?: () => void
  onViewMember: (m: RoomMember) => void
  onAddMembers: (members: RoomMember[]) => void
}) {
  const [search, setSearch] = useState("")
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addQuery, setAddQuery] = useState("")
  const [addSelected, setAddSelected] = useState<number[]>([])
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    actionLabel: string
    isDestructive?: boolean
    onConfirm: () => Promise<void>
  } | null>(null)
  const [processing, setProcessing] = useState(false)

  const members = conv.members || []
  const myMember = members.find((m) => m.id === myMemberId)
  const isOwner =
    myMember?.role === "owner" ||
    myMember?.role === "leader" ||
    (conv.createdBy !== undefined && conv.createdBy === myMemberId)
  const isAdmin = !isOwner && myMember?.role === "admin"

  const filtered = members.filter((m) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      m.name.toLowerCase().includes(q) ||
      (m.username && m.username.toLowerCase().includes(q))
    )
  })

  const addFiltered = friendCandidates.filter((f) => {
    const q = addQuery.trim().toLowerCase()
    if (!q) return true
    return (
      f.name.toLowerCase().includes(q) ||
      (f.username && f.username.toLowerCase().includes(q))
    )
  })

  const toggleSelectFriend = (id: number) => {
    setAddSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleAddSubmit = () => {
    const chosen = friendCandidates.filter((f) => addSelected.includes(f.id))
    if (chosen.length === 0) return
    onAddMembers(chosen)
    setAddSelected([])
    setAddQuery("")
    setAddMemberOpen(false)
  }

  const handleFriendRequest = async (targetId: number, name: string) => {
    const res = await api.friendRequest(targetId)
    if (!res.ok) {
      onPushToast("Không thể gửi lời mời kết bạn: " + (res.error || "Lỗi"))
      return
    }
    onPushToast(`Đã gửi lời mời kết bạn tới ${name}`)
  }

  const handleRemoveMember = async (target: RoomMember) => {
    if (!conv.realId) return
    setProcessing(true)
    const res = await api.removeRoomMember(conv.realId, target.id)
    setProcessing(false)
    setConfirmDialog(null)

    if (!res.ok) {
      onPushToast(
        res.error === "forbidden_cannot_modify_owner"
          ? "Không thể xóa Trưởng nhóm"
          : res.error === "forbidden_cannot_modify_admin"
            ? "Phó nhóm không thể xóa Phó nhóm khác"
            : "Không thể xóa: " + (res.error || "Lỗi"),
      )
      return
    }
    onPushToast(`Đã xóa ${target.name} khỏi nhóm`)
    onRefreshRoom?.()
  }

  const handleBlockMember = async (target: RoomMember) => {
    if (!conv.realId) return
    setProcessing(true)
    const res = await api.blockRoomMember(conv.realId, target.id)
    setProcessing(false)
    setConfirmDialog(null)

    if (!res.ok) {
      onPushToast(
        res.error === "forbidden_cannot_modify_owner"
          ? "Không thể chặn Trưởng nhóm"
          : res.error === "forbidden_cannot_modify_admin"
            ? "Phó nhóm không thể chặn Phó nhóm khác"
            : "Không thể chặn: " + (res.error || "Lỗi"),
      )
      return
    }
    onPushToast(`Đã chặn ${target.name} khỏi nhóm`)
    onRefreshRoom?.()
  }

  const handleRoleChange = async (target: RoomMember, newRole: "admin" | "member") => {
    if (!conv.realId) return
    setProcessing(true)
    const res = await api.setRoomMemberRole(conv.realId, target.id, newRole)
    setProcessing(false)

    if (!res.ok) {
      onPushToast("Không thể đổi vai trò: " + (res.error || "Lỗi"))
      return
    }
    onPushToast(
      newRole === "admin"
        ? `Đã bổ nhiệm ${target.name} làm Phó nhóm`
        : `Đã gỡ quyền Phó nhóm của ${target.name}`,
    )
    onRefreshRoom?.()
  }

  const handleTransferOwner = async (target: RoomMember) => {
    if (!conv.realId) return
    setProcessing(true)
    const res = await api.transferRoomOwner(conv.realId, target.id)
    setProcessing(false)
    setConfirmDialog(null)

    if (!res.ok) {
      onPushToast("Không thể chuyển quyền: " + (res.error || "Lỗi"))
      return
    }
    onPushToast(`Đã chuyển quyền Trưởng nhóm cho ${target.name}`)
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
            aria-label="Quay lại"
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
            Thành viên ({members.length})
          </h2>
        </div>

        <button
          onClick={() => setAddMemberOpen(true)}
          className="px-2.5 py-1 text-xs font-semibold rounded-md transition-opacity hover:opacity-80 flex items-center gap-1"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
          }}
        >
          + Thêm
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-3 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2"
            width="13"
            height="13"
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
            placeholder="Tìm kiếm thành viên..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>
      </div>

      {/* Member List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {filtered.map((m) => {
          const isMe = m.id === myMemberId
          const isTargetOwner =
            m.role === "owner" ||
            m.role === "leader" ||
            (conv.createdBy !== undefined && conv.createdBy === m.id)
          const isTargetAdmin = !isTargetOwner && m.role === "admin"
          const isFriend = friendCandidates.every((fc) => fc.id !== m.id) && !isMe

          const canManage =
            !isMe &&
            (isOwner ||
              (isAdmin && !isTargetOwner && !isTargetAdmin))

          return (
            <div
              key={m.id}
              className="relative flex items-center justify-between p-2.5 rounded-xl transition-colors hover:bg-[var(--surface)]"
            >
              <div
                className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                onClick={() => onViewMember(m)}
              >
                <Avatar
                  sizePx={38}
                  src={m.avatar}
                  name={m.name}
                  initials={initialsOf(m.name)}
                  showPresence={m.online}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                      {m.name} {isMe && "(Bạn)"}
                    </p>
                    {isTargetOwner && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Trưởng nhóm
                      </span>
                    )}
                    {isTargetAdmin && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.2 rounded-full"
                        style={{
                          backgroundColor: "var(--surface)",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        Phó nhóm
                      </span>
                    )}
                  </div>
                  <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                    {m.username ? `@${m.username}` : "Thành viên"}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                {!isMe && !isFriend && (
                  <button
                    onClick={() => void handleFriendRequest(m.id, m.name)}
                    className="px-2 py-1 text-[11px] font-medium rounded-md transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: "var(--surface)",
                      color: "var(--primary)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Kết bạn
                  </button>
                )}

                {canManage && (
                  <div className="relative">
                    <button
                      onClick={() =>
                        setActiveMenuId((cur) => (cur === m.id ? null : m.id))
                      }
                      className="p-1.5 rounded-lg transition-colors hover:bg-[var(--border)]"
                      style={{ color: "var(--muted)" }}
                      aria-label="Tùy chọn thành viên"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>

                    {activeMenuId === m.id && (
                      <div
                        className="absolute right-0 top-full mt-1 w-48 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in"
                        style={{
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {isOwner && (
                          <>
                            {isTargetAdmin ? (
                              <button
                                onClick={() => {
                                  setActiveMenuId(null)
                                  void handleRoleChange(m, "member")
                                }}
                                className="w-full text-left px-3.5 py-2 text-xs transition-colors hover:bg-[var(--border)]"
                                style={{ color: "var(--text)" }}
                              >
                                Gỡ quyền phó nhóm
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setActiveMenuId(null)
                                  void handleRoleChange(m, "admin")
                                }}
                                className="w-full text-left px-3.5 py-2 text-xs transition-colors hover:bg-[var(--border)]"
                                style={{ color: "var(--text)" }}
                              >
                                Bổ nhiệm làm phó nhóm
                              </button>
                            )}

                            <button
                              onClick={() => {
                                setActiveMenuId(null)
                                setConfirmDialog({
                                  title: "Chuyển quyền trưởng nhóm",
                                  message: `Bạn có chắc muốn chuyển quyền Trưởng nhóm cho ${m.name}? Bạn sẽ trở thành Phó nhóm.`,
                                  actionLabel: "Chuyển quyền",
                                  onConfirm: () => handleTransferOwner(m),
                                })
                              }}
                              className="w-full text-left px-3.5 py-2 text-xs transition-colors hover:bg-[var(--border)]"
                              style={{ color: "var(--text)" }}
                            >
                              Chuyển quyền trưởng nhóm
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => {
                            setActiveMenuId(null)
                            setConfirmDialog({
                              title: "Chặn khỏi nhóm",
                              message: `Chặn ${m.name} khỏi nhóm? Người này sẽ bị xóa và không thể tham gia lại cho đến khi được bỏ chặn.`,
                              actionLabel: "Chặn",
                              isDestructive: true,
                              onConfirm: () => handleBlockMember(m),
                            })
                          }}
                          className="w-full text-left px-3.5 py-2 text-xs transition-colors hover:bg-[var(--border)]"
                          style={{ color: "var(--error)" }}
                        >
                          Chặn khỏi nhóm
                        </button>

                        <button
                          onClick={() => {
                            setActiveMenuId(null)
                            setConfirmDialog({
                              title: "Xóa khỏi nhóm",
                              message: `Xác nhận xóa ${m.name} khỏi nhóm này?`,
                              actionLabel: "Xóa",
                              isDestructive: true,
                              onConfirm: () => handleRemoveMember(m),
                            })
                          }}
                          className="w-full text-left px-3.5 py-2 text-xs transition-colors hover:bg-[var(--border)]"
                          style={{ color: "var(--error)" }}
                        >
                          Xóa khỏi nhóm
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Member Modal */}
      {addMemberOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-3 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                Thêm thành viên
              </h3>
              <button
                onClick={() => setAddMemberOpen(false)}
                className="p-1 rounded text-xs"
                style={{ color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="Tìm bạn bè..."
                className="w-full px-3 py-1.5 text-xs rounded-lg outline-none"
                style={{
                  backgroundColor: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>

            {addFiltered.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: "var(--muted)" }}>
                Không tìm thấy bạn bè để thêm
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-1">
                {addFiltered.map((f) => {
                  const checked = addSelected.includes(f.id)
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleSelectFriend(f.id)}
                      className="p-2 rounded-lg flex items-center justify-between text-left transition-colors hover:bg-[var(--bg)]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          sizePx={32}
                          src={f.avatar}
                          name={f.name}
                          initials={initialsOf(f.name)}
                          showPresence={f.online}
                        />
                        <span className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                          {f.name}
                        </span>
                      </div>
                      <span
                        className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                        style={{
                          borderColor: checked ? "var(--primary)" : "var(--border)",
                          backgroundColor: checked ? "var(--primary)" : "transparent",
                        }}
                      >
                        {checked && (
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ color: "var(--primary-fg)" }}
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => setAddMemberOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg"
                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Hủy
              </button>
              <button
                disabled={addSelected.length === 0}
                onClick={handleAddSubmit}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                }}
              >
                Thêm ({addSelected.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              {confirmDialog.title}
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              {confirmDialog.message}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                disabled={processing}
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg"
                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Hủy
              </button>
              <button
                disabled={processing}
                onClick={() => void confirmDialog.onConfirm()}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg"
                style={{
                  backgroundColor: confirmDialog.isDestructive ? "var(--error)" : "var(--primary)",
                  color: "#fff",
                }}
              >
                {processing ? "Đang xử lý..." : confirmDialog.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
