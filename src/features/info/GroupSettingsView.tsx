import { useState } from "react"
import { api } from "../../lib/api"
import type { Conversation, RoomSettings } from "../../types/chat"

function Toggle({
  value,
  disabled,
  onChange,
}: {
  value: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onChange}
      className={`w-9 h-5 rounded-full flex-shrink-0 transition-colors ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
      style={{
        backgroundColor: value ? "var(--primary)" : "var(--border)",
      }}
      aria-checked={value}
      role="switch"
    >
      <span
        className="block w-3.5 h-3.5 rounded-full shadow-xs transition-transform"
        style={{
          backgroundColor: value ? "var(--primary-fg)" : "var(--bg)",
          transform: value ? "translateX(18px)" : "translateX(3px)",
        }}
      />
    </button>
  )
}

function CheckboxItem({
  label,
  checked,
  disabled,
  tooltip,
  badgeSoon,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  tooltip: string
  badgeSoon?: boolean
  onChange: () => void
}) {
  const [showTip, setShowTip] = useState(false)

  return (
    <div className="flex flex-col py-2 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-2">
        <label
          className={`flex items-center gap-2.5 text-xs font-medium cursor-pointer flex-1 select-none ${
            disabled ? "opacity-60 cursor-not-allowed" : ""
          }`}
          style={{ color: "var(--text)" }}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onChange}
            className="w-4 h-4 rounded accent-[var(--primary)] cursor-pointer"
          />
          <span className="flex items-center gap-1.5 flex-wrap">
            {label}
            {badgeSoon && (
              <span
                className="text-[9px] px-1.5 py-0.2 rounded font-medium"
                style={{
                  backgroundColor: "var(--surface)",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                Sắp có
              </span>
            )}
          </span>
        </label>

        <button
          onClick={() => setShowTip((v) => !v)}
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-opacity hover:opacity-80 flex-shrink-0"
          style={{
            backgroundColor: "var(--surface)",
            color: "var(--muted)",
            border: "1px solid var(--border)",
          }}
          title="Giải thích"
          aria-label={`Giải thích ${label}`}
        >
          ?
        </button>
      </div>

      {showTip && (
        <p className="mt-1 text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
          {tooltip}
        </p>
      )}
    </div>
  )
}

function SwitchItem({
  label,
  checked,
  disabled,
  tooltip,
  badgeSoon,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  tooltip: string
  badgeSoon?: boolean
  onChange: () => void
}) {
  const [showTip, setShowTip] = useState(false)

  return (
    <div className="flex flex-col py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>
            {label}
          </span>
          {badgeSoon && (
            <span
              className="text-[9px] px-1.5 py-0.2 rounded font-medium flex-shrink-0"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              Sắp có
            </span>
          )}
          <button
            onClick={() => setShowTip((v) => !v)}
            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold transition-opacity hover:opacity-80 flex-shrink-0"
            style={{
              backgroundColor: "var(--surface)",
              color: "var(--muted)",
              border: "1px solid var(--border)",
            }}
            title="Giải thích"
            aria-label={`Giải thích ${label}`}
          >
            ?
          </button>
        </div>
        <Toggle value={checked} disabled={disabled} onChange={onChange} />
      </div>

      {showTip && (
        <p className="mt-1 text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
          {tooltip}
        </p>
      )}
    </div>
  )
}

export function GroupSettingsView({
  conv,
  myMemberId,
  onBack,
  onNavigate,
  onPushToast,
  onPatch,
  onLeaveRoom,
}: {
  conv: Conversation
  myMemberId?: number
  onBack: () => void
  onNavigate: (view: "join_requests" | "roles" | "blocks" | "members") => void
  onPushToast: (msg: string) => void
  onPatch: (patch: Partial<Conversation>) => void
  onLeaveRoom: () => void
}) {
  const defaultSettings: RoomSettings = {
    allow_member_edit_info: true,
    allow_member_pin: true,
    allow_member_notes_reminders: true,
    allow_member_polls: true,
    allow_member_send: true,
    require_join_approval: false,
    highlight_admin_messages: true,
    new_member_read_recent: true,
    join_link_enabled: false,
    join_token: "",
  }

  const [settings, setSettings] = useState<RoomSettings>(
    conv.settings || defaultSettings,
  )
  const [dissolveModalOpen, setDissolveModalOpen] = useState(false)
  const [dissolveConfirmText, setDissolveConfirmText] = useState("")
  const [dissolving, setDissolving] = useState(false)
  const [regeneratingToken, setRegeneratingToken] = useState(false)

  const members = conv.members || []
  const myMember = members.find((m) => m.id === myMemberId)
  const isOwner =
    myMember?.role === "owner" ||
    myMember?.role === "leader" ||
    (conv.createdBy !== undefined && conv.createdBy === myMemberId)
  const isAdmin = !isOwner && myMember?.role === "admin"
  const isPrivileged = isOwner || isAdmin

  const pendingCount = conv.pending_join_requests_count ?? 0

  const handleUpdate = async (patch: Partial<RoomSettings>) => {
    if (!isPrivileged) {
      onPushToast("Chỉ trưởng hoặc phó nhóm mới có quyền thay đổi cài đặt")
      return
    }
    const next = { ...settings, ...patch }
    setSettings(next)

    if (conv.realId) {
      const res = await api.updateRoomSettings(conv.realId, patch)
      if (!res.ok) {
        onPushToast("Không thể lưu cài đặt: " + (res.error || "Lỗi"))
        setSettings(settings) // rollback
        return
      }
      onPatch({ settings: next })
      onPushToast("Đã cập nhật cài đặt nhóm")
    }
  }

  const handleRegenerateToken = async () => {
    if (!conv.realId || regeneratingToken) return
    setRegeneratingToken(true)
    const res = await api.regenerateRoomJoinToken(conv.realId)
    setRegeneratingToken(false)

    if (!res.ok || !res.data) {
      onPushToast("Không thể tạo link mới: " + (res.error || "Lỗi"))
      return
    }

    const next = { ...settings, join_token: res.data.token, join_link_enabled: true }
    setSettings(next)
    onPatch({ settings: next })
    onPushToast("Đã đổi link tham gia mới")
  }

  const handleCopyLink = () => {
    const link = `${window.location.origin}/r/${settings.join_token || conv.realId}`
    navigator.clipboard.writeText(link)
    onPushToast("Đã sao chép liên kết tham gia vào bộ nhớ tạm")
  }

  const handleDissolveRoom = async () => {
    if (!isOwner || !conv.realId || dissolving) return
    if (dissolveConfirmText.trim() !== conv.name.trim()) {
      onPushToast("Tên nhóm nhập không chính xác")
      return
    }

    setDissolving(true)
    const res = await api.dissolveRoom(conv.realId)
    setDissolving(false)
    setDissolveModalOpen(false)

    if (!res.ok) {
      onPushToast("Không thể giải tán nhóm: " + (res.error || "Lỗi"))
      return
    }

    onPushToast("Đã giải tán nhóm thành công")
    onLeaveRoom()
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
            Quản lý nhóm
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        {!isPrivileged && (
          <div
            className="p-3 rounded-xl text-xs flex items-center gap-2"
            style={{
              backgroundColor: "var(--surface)",
              color: "var(--muted)",
              border: "1px solid var(--border)",
            }}
          >
            <span>ℹ️</span>
            <span>Bạn đang xem cài đặt nhóm ở chế độ chỉ đọc. Chỉ Trưởng và Phó nhóm mới có quyền chỉnh sửa.</span>
          </div>
        )}

        {/* 1. Navigation Menu Items */}
        <div
          className="rounded-xl overflow-hidden flex flex-col"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          {isPrivileged && (
            <button
              onClick={() => onNavigate("join_requests")}
              className="px-4 py-3 flex items-center justify-between text-left transition-colors hover:bg-[var(--border)] border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                Duyệt thành viên
              </span>
              <div className="flex items-center gap-2">
                {pendingCount > 0 && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-fg)",
                    }}
                  >
                    {pendingCount}
                  </span>
                )}
                <svg
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
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          )}

          <button
            onClick={() => onNavigate("roles")}
            className="px-4 py-3 flex items-center justify-between text-left transition-colors hover:bg-[var(--border)] border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
              Trưởng & phó nhóm
            </span>
            <svg
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
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {isPrivileged && (
            <button
              onClick={() => onNavigate("blocks")}
              className="px-4 py-3 flex items-center justify-between text-left transition-colors hover:bg-[var(--border)]"
            >
              <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                Chặn khỏi nhóm
              </span>
              <svg
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
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>

        {/* 2. Cho phép các thành viên trong nhóm (5 Checkboxes) */}
        <div>
          <h3
            className="text-xs font-bold uppercase tracking-wider mb-2"
            style={{ color: "var(--muted)" }}
          >
            Cho phép các thành viên trong nhóm:
          </h3>
          <div
            className="p-3.5 rounded-xl flex flex-col"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <CheckboxItem
              label="Thay đổi tên & ảnh nhóm"
              checked={settings.allow_member_edit_info}
              disabled={!isPrivileged}
              tooltip="Cho phép mọi thành viên trong nhóm cập nhật tên nhóm, ảnh đại diện và ảnh nền."
              onChange={() =>
                handleUpdate({
                  allow_member_edit_info: !settings.allow_member_edit_info,
                })
              }
            />
            <CheckboxItem
              label="Ghim tin nhắn, ghi chú, bình chọn"
              checked={settings.allow_member_pin}
              disabled={!isPrivileged}
              badgeSoon
              tooltip="Cho phép các thành viên ghim tin nhắn hoặc nội dung quan trọng lên đầu nhóm chat."
              onChange={() =>
                handleUpdate({ allow_member_pin: !settings.allow_member_pin })
              }
            />
            <CheckboxItem
              label="Tạo mới ghi chú, nhắc hẹn"
              checked={settings.allow_member_notes_reminders}
              disabled={!isPrivileged}
              badgeSoon
              tooltip="Cho phép thành viên tạo ghi chú chung và cài đặt nhắc hẹn sự kiện trong phòng."
              onChange={() =>
                handleUpdate({
                  allow_member_notes_reminders:
                    !settings.allow_member_notes_reminders,
                })
              }
            />
            <CheckboxItem
              label="Tạo mới bình chọn"
              checked={settings.allow_member_polls}
              disabled={!isPrivileged}
              badgeSoon
              tooltip="Cho phép thành viên tạo câu hỏi biểu quyết / thăm dò ý kiến trong nhóm."
              onChange={() =>
                handleUpdate({
                  allow_member_polls: !settings.allow_member_polls,
                })
              }
            />
            <CheckboxItem
              label="Gửi tin nhắn"
              checked={settings.allow_member_send}
              disabled={!isPrivileged}
              tooltip="Khi tắt, chỉ Trưởng và Phó nhóm mới có quyền gửi tin nhắn. Ô nhập của thành viên thường sẽ bị khóa."
              onChange={() =>
                handleUpdate({
                  allow_member_send: !settings.allow_member_send,
                })
              }
            />
          </div>
        </div>

        {/* 3. Các công tắc quản trị */}
        <div>
          <h3
            className="text-xs font-bold uppercase tracking-wider mb-2"
            style={{ color: "var(--muted)" }}
          >
            Cài đặt quản trị:
          </h3>
          <div
            className="p-3.5 rounded-xl flex flex-col"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <SwitchItem
              label="Chế độ phê duyệt thành viên mới"
              checked={settings.require_join_approval}
              disabled={!isPrivileged}
              tooltip="Khi bật, thành viên do người khác mời hoặc tham gia qua liên kết phải được Trưởng/Phó nhóm duyệt trước khi vào nhóm."
              onChange={() =>
                handleUpdate({
                  require_join_approval: !settings.require_join_approval,
                })
              }
            />
            <SwitchItem
              label="Đánh dấu tin nhắn từ trưởng/phó nhóm"
              checked={settings.highlight_admin_messages}
              disabled={!isPrivileged}
              tooltip="Gắn huy hiệu nổi bật bên cạnh tên và tin nhắn của Trưởng nhóm và Phó nhóm."
              onChange={() =>
                handleUpdate({
                  highlight_admin_messages: !settings.highlight_admin_messages,
                })
              }
            />
            <SwitchItem
              label="Cho phép thành viên mới đọc tin nhắn gần nhất"
              checked={settings.new_member_read_recent}
              disabled={!isPrivileged}
              tooltip="Người mới tham gia nhóm có thể xem lịch sử các tin nhắn đã gửi trước đó."
              onChange={() =>
                handleUpdate({
                  new_member_read_recent: !settings.new_member_read_recent,
                })
              }
            />
            <SwitchItem
              label="Cho phép dùng link tham gia nhóm"
              checked={settings.join_link_enabled}
              disabled={!isPrivileged}
              tooltip="Bật liên kết mời để bất kỳ ai có link đều có thể xin vào nhóm."
              onChange={() =>
                handleUpdate({
                  join_link_enabled: !settings.join_link_enabled,
                })
              }
            />

            {/* Link details box when enabled */}
            {settings.join_link_enabled && (
              <div
                className="mt-3 p-3 rounded-lg flex flex-col gap-2"
                style={{
                  backgroundColor: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              >
                <span className="text-[11px] font-semibold" style={{ color: "var(--muted)" }}>
                  Liên kết tham gia nhóm:
                </span>
                <div
                  className="px-2.5 py-1.5 rounded text-xs select-all truncate font-mono"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {`${window.location.origin}/r/${settings.join_token || conv.realId}`}
                </div>
                {isPrivileged && (
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <button
                      onClick={handleCopyLink}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: "var(--primary)",
                        color: "var(--primary-fg)",
                      }}
                    >
                      Sao chép
                    </button>
                    <button
                      disabled={regeneratingToken}
                      onClick={handleRegenerateToken}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--surface)",
                        color: "var(--text)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {regeneratingToken ? "Đang đổi..." : "Đổi link"}
                    </button>
                    <button
                      onClick={() => handleUpdate({ join_link_enabled: false })}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: "var(--surface)",
                        color: "var(--error)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Thu hồi
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 4. Giải tán nhóm (Chỉ Trưởng nhóm thấy) */}
        {isOwner && (
          <div className="pt-2">
            <button
              onClick={() => {
                setDissolveConfirmText("")
                setDissolveModalOpen(true)
              }}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--error)",
                border: "1px solid var(--error)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              Giải tán nhóm
            </button>
          </div>
        )}
      </div>

      {/* Dissolve Room Modal */}
      {dissolveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl flex flex-col gap-4 animate-in fade-in"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <h3 className="text-base font-semibold" style={{ color: "var(--error)" }}>
              Giải tán nhóm vĩnh viễn?
            </h3>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text)" }}>
              Hành động này sẽ xóa toàn bộ thành viên và giải tán nhóm ngay lập tức. Hành động này{" "}
              <strong>không thể hoàn tác</strong>.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px]" style={{ color: "var(--muted)" }}>
                Vui lòng gõ chính xác tên nhóm <strong>{conv.name}</strong> để xác nhận:
              </label>
              <input
                type="text"
                value={dissolveConfirmText}
                onChange={(e) => setDissolveConfirmText(e.target.value)}
                placeholder={conv.name}
                className="w-full px-3 py-1.5 text-xs rounded-lg outline-none"
                style={{
                  backgroundColor: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                disabled={dissolving}
                onClick={() => setDissolveModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg"
                style={{ color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                Hủy
              </button>
              <button
                disabled={dissolving || dissolveConfirmText.trim() !== conv.name.trim()}
                onClick={() => void handleDissolveRoom()}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-40"
                style={{
                  backgroundColor: "var(--error)",
                  color: "#fff",
                }}
              >
                {dissolving ? "Đang giải tán..." : "Xác nhận giải tán"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
