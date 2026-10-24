import { useState, useRef, useEffect } from "react"
import { api } from "../lib/api"
import { maxSelectableFriends } from "../lib/roomLimits"
import { Avatar } from "./Avatar"

export interface RoomMember {
  id: number
  name: string
  username?: string
  initials: string
  online: boolean
  publicId?: string
  /** Ảnh đại diện (data-URI hoặc URL) nếu có; thiếu thì giao diện dùng chữ viết tắt. */
  avatar?: string
}

export const FRIENDS: RoomMember[] = []

/** Mặc định khi chưa tải được cấu hình từ Tracker (khớp DEFAULT_MAX_ROOM_MEMBERS phía server). */
const DEFAULT_MAX_MEMBERS = 20

interface Props {
  onClose: () => void
  onCreate: (room: {
    name: string
    avatar?: string
    members: RoomMember[]
  }) => void
}

export function CreateRoomModal({ onClose, onCreate }: Props) {
  const [name, setName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [users, setUsers] = useState<RoomMember[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [maxMembers, setMaxMembers] = useState(DEFAULT_MAX_MEMBERS)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Giới hạn thành viên do admin cấu hình (không nhạy cảm) — tải trước khi chọn.
    api.publicConfig().then((r) => {
      const n = r.data?.max_room_members
      if (r.ok && typeof n === "number" && n >= 2) setMaxMembers(n)
    })
  }, [])

  useEffect(() => {
    let alive = true
    setLoadingUsers(true)
    // LUỒNG 2d: chỉ liệt kê BẠN BÈ đã kết bạn (không liệt kê toàn bộ người dùng hệ thống).
    api.friendsList().then((r) => {
      if (!alive) return
      if (r.ok && r.data) {
        setUsers(
          r.data.friends
            .filter((u) => typeof u.id === "number")
            .map((u) => {
              const nm = u.display_name
              return {
                id: u.id as number,
                name: nm,
                initials: nm
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((w) => w[0].toUpperCase())
                  .slice(0, 2)
                  .join(""),
                online: u.online ?? false,
                publicId: u.public_id,
                avatar: u.avatar || undefined,
              }
            }),
        )
      }
      setLoadingUsers(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const filtered = users.filter((f) =>
    f.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  // Giới hạn tính CẢ người tạo: số bạn được chọn tối đa = maxMembers - 1 (người tạo).
  const maxSelectable = maxSelectableFriends(maxMembers)
  const atLimit = selectedIds.length >= maxSelectable

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= maxSelectable) return prev
      return [...prev, id]
    })
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setAvatarUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleCreate = () => {
    if (selectedIds.length === 0) return
    onCreate({
      name: name.trim() || "Phòng mới",
      avatar: avatarUrl,
      members: users.filter((f) => selectedIds.includes(f.id)),
    })
  }

  const initials = name.trim()
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "#"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-xl flex flex-col"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
          maxHeight: "85vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--text)" }}
          >
            Tạo phòng
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {/* Room name + avatar */}
          <div className="flex items-center gap-4 mb-5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px dashed var(--border)",
                color: "var(--muted)",
              }}
              title="Tải ảnh đại diện phòng (tuỳ chọn)"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span
                  className="text-lg font-semibold"
                  style={{ color: "var(--text)" }}
                >
                  {initials}
                </span>
              )}
              <span
                className="absolute bottom-0 right-0 w-5 h-5 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                  border: "2px solid var(--bg)",
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </span>
            </button>
            <div className="flex-1">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--muted)" }}
              >
                Tên phòng
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nhập tên phòng..."
                className="w-full px-3 py-2 text-sm rounded-md outline-none"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          {/* Search members */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Chọn thành viên
            </p>
            <span
              className="text-xs"
              style={{ color: atLimit ? "var(--error)" : "var(--muted)" }}
            >
              Đã chọn {selectedIds.length + 1}/{maxMembers} (gồm bạn)
            </span>
          </div>
          {atLimit && (
            <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
              Đã đạt giới hạn {maxMembers} thành viên mỗi phòng (kể cả bạn).
            </p>
          )}
          <div className="relative mb-2">
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm bạn bè..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md outline-none"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
          </div>

          {/* Member list */}
          <div className="flex flex-col">
            {loadingUsers ? (
              <p
                className="text-sm text-center py-6"
                style={{ color: "var(--muted)" }}
              >
                Đang tải danh sách người dùng...
              </p>
            ) : filtered.length === 0 ? (
              <p
                className="text-sm text-center py-6"
                style={{ color: "var(--muted)" }}
              >
                Không tìm thấy người dùng phù hợp.
              </p>
            ) : (
              filtered.map((f) => {
                const checked = selectedIds.includes(f.id)
                const disabled = atLimit && !checked
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle(f.id)}
                    disabled={disabled}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-md transition-colors text-left hover:opacity-80 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: checked
                        ? "var(--surface)"
                        : "transparent",
                      opacity: disabled ? 0.4 : 1,
                    }}
                  >
                    <Avatar
                      sizePx={36}
                      src={f.avatar}
                      name={f.name}
                      initials={f.initials}
                      online={f.online}
                    />
                    <span
                      className="flex-1 text-sm font-medium truncate"
                      style={{ color: "var(--text)" }}
                    >
                      {f.name}
                    </span>
                    <span
                      className="w-4.5 h-4.5 rounded flex items-center justify-center flex-shrink-0"
                      style={{
                        width: "18px",
                        height: "18px",
                        backgroundColor: checked
                          ? "var(--primary)"
                          : "transparent",
                        border: checked ? "none" : "1.5px solid var(--border)",
                        color: "var(--primary-fg)",
                      }}
                    >
                      {checked && (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex gap-3 px-6 py-4 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text)",
              backgroundColor: "var(--bg)",
            }}
          >
            Huỷ
          </button>
          <button
            onClick={handleCreate}
            disabled={selectedIds.length === 0}
            className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
              opacity: selectedIds.length === 0 ? 0.4 : 1,
              cursor: selectedIds.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Tạo phòng
          </button>
        </div>
      </div>
    </div>
  )
}
