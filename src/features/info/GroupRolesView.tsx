import { useState } from "react"
import { Avatar } from "../../components/Avatar"
import { initialsOf } from "../chat/bubbles/VoiceBubble"
import { api } from "../../lib/api"
import type { Conversation, RoomMember } from "../../types/chat"

export function GroupRolesView({
  conv,
  myMemberId,
  onBack,
  onPushToast,
  onRefreshRoom,
}: {
  conv: Conversation
  myMemberId?: number
  onBack: () => void
  onPushToast: (msg: string) => void
  onRefreshRoom?: () => void
}) {
  const [addAdminOpen, setAddAdminOpen] = useState(false)
  const [transferOwnerOpen, setTransferOwnerOpen] = useState(false)
  const [selectedUserForTransfer, setSelectedUserForTransfer] = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [confirmDemote, setConfirmDemote] = useState<RoomMember | null>(null)

  const members = conv.members || []
  const owner = members.find(
    (m) =>
      m.role === "owner" ||
      m.role === "leader" ||
      (conv.createdBy !== undefined && conv.createdBy === m.id),
  ) || members[0]

  const admins = members.filter(
    (m) => m.id !== owner?.id && m.role === "admin",
  )

  const regularMembers = members.filter(
    (m) => m.id !== owner?.id && m.role !== "admin",
  )

  const isMeOwner = myMemberId !== undefined && owner?.id === myMemberId

  const handlePromoteAdmin = async (userId: number) => {
    if (processing || !conv.realId) return
    setProcessing(true)
    const res = await api.setRoomMemberRole(conv.realId, userId, "admin")
    setProcessing(false)
    setAddAdminOpen(false)

    if (!res.ok) {
      onPushToast("Không thể bổ nhiệm: " + (res.error || "Lỗi"))
      return
    }

    const u = members.find((m) => m.id === userId)
    onPushToast(`Đã bổ nhiệm ${u?.name || "thành viên"} làm Phó nhóm`)
    onRefreshRoom?.()
  }

  const handleDemoteAdmin = async (admin: RoomMember) => {
    if (processing || !conv.realId) return
    setProcessing(true)
    const res = await api.setRoomMemberRole(conv.realId, admin.id, "member")
    setProcessing(false)
    setConfirmDemote(null)

    if (!res.ok) {
      onPushToast("Không thể gỡ quyền: " + (res.error || "Lỗi"))
      return
    }

    onPushToast(`Đã gỡ quyền Phó nhóm của ${admin.name}`)
    onRefreshRoom?.()
  }

  const handleTransferOwner = async () => {
    if (processing || !conv.realId || !selectedUserForTransfer) return
    setProcessing(true)
    const res = await api.transferRoomOwner(conv.realId, selectedUserForTransfer)
    setProcessing(false)
    setTransferOwnerOpen(false)

    if (!res.ok) {
      onPushToast("Không thể chuyển quyền: " + (res.error || "Lỗi"))
      return
    }

    const u = members.find((m) => m.id === selectedUserForTransfer)
    onPushToast(`Đã chuyển quyền Trưởng nhóm cho ${u?.name || "thành viên"}`)
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
            Trưởng & phó nhóm
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {/* 1. Trưởng nhóm */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Trưởng nhóm
            </span>
            {isMeOwner && (
              <button
                onClick={() => setTransferOwnerOpen(true)}
                className="text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ color: "var(--primary)" }}
              >
                Chuyển quyền
              </button>
            )}
          </div>

          {owner ? (
            <div
              className="p-3.5 rounded-xl flex items-center justify-between gap-3"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  sizePx={40}
                  src={owner.avatar}
                  name={owner.name}
                  initials={initialsOf(owner.name)}
                  showPresence={owner.online}
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                    {owner.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                    {owner.username ? `@${owner.username}` : "Trưởng nhóm"}
                  </p>
                </div>
              </div>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                }}
              >
                Trưởng nhóm
              </span>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Chưa xác định trưởng nhóm
            </p>
          )}
        </div>

        {/* 2. Phó nhóm */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Phó nhóm ({admins.length})
            </span>
            {isMeOwner && (
              <button
                onClick={() => setAddAdminOpen(true)}
                className="text-xs font-semibold transition-opacity hover:opacity-80 flex items-center gap-1"
                style={{ color: "var(--primary)" }}
              >
                + Thêm phó nhóm
              </button>
            )}
          </div>

          {admins.length === 0 ? (
            <div
              className="p-5 rounded-xl text-center flex flex-col items-center gap-1"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px dashed var(--border)",
              }}
            >
              <p className="text-xs font-medium" style={{ color: "var(--text)" }}>
                Chưa có phó nhóm nào
              </p>
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                {isMeOwner
                  ? "Bổ nhiệm phó nhóm để hỗ trợ duyệt thành viên và quản lý nhóm"
                  : "Nhóm chưa được phân công phó nhóm"}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {admins.map((adm) => (
                <div
                  key={adm.id}
                  className="p-3.5 rounded-xl flex items-center justify-between gap-3"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      sizePx={38}
                      src={adm.avatar}
                      name={adm.name}
                      initials={initialsOf(adm.name)}
                      showPresence={adm.online}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                        {adm.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                        {adm.username ? `@${adm.username}` : "Phó nhóm"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: "var(--surface)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Phó nhóm
                    </span>
                    {isMeOwner && (
                      <button
                        onClick={() => setConfirmDemote(adm)}
                        className="px-2 py-1 text-xs rounded transition-opacity hover:opacity-80"
                        style={{ color: "var(--error)" }}
                      >
                        Gỡ
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Admin Modal */}
      {addAdminOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                Thêm phó nhóm
              </h3>
              <button
                onClick={() => setAddAdminOpen(false)}
                className="p-1 rounded text-xs"
                style={{ color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>

            {regularMembers.length === 0 ? (
              <p className="text-xs py-4 text-center" style={{ color: "var(--muted)" }}>
                Không có thành viên thường nào để bổ nhiệm
              </p>
            ) : (
              <div className="max-h-60 overflow-y-auto flex flex-col gap-1 pr-1">
                {regularMembers.map((m) => (
                  <button
                    key={m.id}
                    disabled={processing}
                    onClick={() => void handlePromoteAdmin(m.id)}
                    className="p-2.5 rounded-lg flex items-center justify-between text-left transition-colors hover:bg-[var(--border)]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        sizePx={32}
                        src={m.avatar}
                        name={m.name}
                        initials={initialsOf(m.name)}
                        showPresence={m.online}
                      />
                      <span className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                        {m.name}
                      </span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
                      Chọn
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Demote Confirmation Modal */}
      {confirmDemote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
              Gỡ quyền phó nhóm?
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              Bạn có chắc muốn gỡ quyền Phó nhóm của <strong>{confirmDemote.name}</strong>? Người này sẽ trở thành thành viên thông thường.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                disabled={processing}
                onClick={() => setConfirmDemote(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg"
                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Hủy
              </button>
              <button
                disabled={processing}
                onClick={() => void handleDemoteAdmin(confirmDemote)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg"
                style={{
                  backgroundColor: "var(--error)",
                  color: "#fff",
                }}
              >
                {processing ? "Đang gỡ..." : "Xác nhận gỡ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Owner Modal */}
      {transferOwnerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                Chuyển quyền trưởng nhóm
              </h3>
              <button
                onClick={() => {
                  setTransferOwnerOpen(false)
                  setSelectedUserForTransfer(null)
                }}
                className="p-1 rounded text-xs"
                style={{ color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>

            <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              Chọn thành viên sẽ trở thành Trưởng nhóm mới. Bạn sẽ trở thành Phó nhóm sau khi chuyển quyền.
            </p>

            <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-1">
              {members
                .filter((m) => m.id !== owner?.id)
                .map((m) => {
                  const selected = selectedUserForTransfer === m.id
                  return (
                    <button
                      key={m.id}
                      onClick={() => setSelectedUserForTransfer(m.id)}
                      className={`p-2.5 rounded-lg flex items-center justify-between text-left transition-colors ${
                        selected ? "ring-2" : "hover:bg-[var(--border)]"
                      }`}
                      style={{
                        backgroundColor: selected ? "var(--border)" : "transparent",
                        ringColor: "var(--primary)",
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar
                          sizePx={32}
                          src={m.avatar}
                          name={m.name}
                          initials={initialsOf(m.name)}
                          showPresence={m.online}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                            {m.name}
                          </p>
                          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                            {m.role === "admin" ? "Phó nhóm" : "Thành viên"}
                          </p>
                        </div>
                      </div>
                      {selected && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ color: "var(--primary)" }}
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
              <button
                disabled={processing}
                onClick={() => {
                  setTransferOwnerOpen(false)
                  setSelectedUserForTransfer(null)
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg"
                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Hủy
              </button>
              <button
                disabled={processing || !selectedUserForTransfer}
                onClick={() => void handleTransferOwner()}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-50"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                }}
              >
                {processing ? "Đang chuyển..." : "Xác nhận chuyển"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
