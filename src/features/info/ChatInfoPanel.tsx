import { useState } from "react"
import { Avatar } from "../../components/Avatar"
import { AvatarStack } from "../../components/AvatarStack"
import type { RoomMember } from "../../components/CreateRoomModal"
import { type Conversation, formatBytes } from "../../types/chat"
import { presenceText } from "../../lib/presenceLabel"
import { THEME_COLORS, themeIcon, EMOJI_CHOICE } from "../chat/emojiData"
import { downloadFile } from "../chat/bubbles/FileBubble"
import { GroupSettingsView } from "./GroupSettingsView"
import { GroupMembersView } from "./GroupMembersView"
import { GroupJoinRequestsView } from "./GroupJoinRequestsView"
import { GroupRolesView } from "./GroupRolesView"
import { GroupBlocksView } from "./GroupBlocksView"

const urlPattern = /https?:\/\/[^\s]+/g

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="w-9 h-5 rounded-full flex-shrink-0 transition-colors"
      style={{
        backgroundColor: value ? "var(--primary)" : "var(--border)",
      }}
      title={value ? "Bật" : "Tắt"}
    >
      <span
        className="block w-3.5 h-3.5 rounded-full shadow-sm transition-transform"
        style={{
          backgroundColor: value ? "var(--primary-fg)" : "var(--bg)",
          transform: value ? "translateX(18px)" : "translateX(3px)",
        }}
      />
    </button>
  )
}

export function InfoPanel({
  conv,
  admins,
  myMemberId,
  friendCandidates,
  onPatch,
  onToggleAdmin,
  onRemoveMember,
  onAddMembers,
  onViewMember,
  onLeaveRoom,
  onBlock,
  onUnblock,
  onDeleteChat,
  onReport,
  onPushToast,
  onClose,
  onOpenLightbox,
  onDownloadFile,
}: {
  conv: Conversation
  admins: number[]
  myMemberId?: number
  friendCandidates: RoomMember[]
  onPatch: (patch: Partial<Conversation>) => void
  onToggleAdmin: (memberId: number) => void
  onRemoveMember: (memberId: number) => void
  onAddMembers: (members: RoomMember[]) => void
  onViewMember: (m: RoomMember) => void
  onLeaveRoom: () => void
  onBlock: () => void
  onUnblock: () => void
  onDeleteChat: () => void
  onReport: () => void
  onPushToast: (text: string) => void
  onClose: () => void
  onOpenLightbox: (msgId: number) => void
  onDownloadFile?: (msg: Message) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    custom: true,
  })
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameVal, setRenameVal] = useState(conv.name)
  const [themeOpen, setThemeOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [nickOpen, setNickOpen] = useState(false)
  const [nickBuf, setNickBuf] = useState<Record<number, string>>({})
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addQuery, setAddQuery] = useState("")
  const [addSel, setAddSel] = useState<number[]>([])
  const [memberMenu, setMemberMenu] = useState<number | null>(null)
  const [tab, setTab] = useState<"media" | "files" | "links">("media")
  const [reportOpen, setReportOpen] = useState(false)
  const [reportText, setReportText] = useState("")
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    label: string
    onConfirm: () => void
  } | null>(null)
  const [avatarInput, setAvatarInput] = useState<HTMLInputElement | null>(null)
  const [bgInput, setBgInput] = useState<HTMLInputElement | null>(null)
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [subView, setSubView] = useState<
    "none" | "group_settings" | "members" | "join_requests" | "roles" | "blocks"
  >("none")

  const isGroup = !!conv.isGroup
  const isSelfAdmin = admins.includes(myMemberId as number)
  const images = conv.messages.filter(
    (m) => m.file?.isImage && m.file.done && m.file.url,
  )
  const files = conv.messages.filter(
    (m) => m.file && !m.file.isImage && m.file.done,
  )
  const links = conv.messages
    .map((m) =>
      (m.text.match(urlPattern) ?? []).map((u) => ({ url: u, id: m.id })),
    )
    .flat()
    .slice(0, 12)

  const addFiltered = friendCandidates.filter((f) =>
    f.name.toLowerCase().includes(addQuery.trim().toLowerCase()),
  )

  const toggleAddSel = (id: number) => {
    setAddSel((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleAddMembers = () => {
    const chosen = friendCandidates.filter((f) => addSel.includes(f.id))
    if (chosen.length === 0) return
    onAddMembers(chosen)
    setAddSel([])
    setAddQuery("")
    setAddMemberOpen(false)
  }

  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  const compressAvatar = (dataUrl: string, done: (url: string) => void) => {
    const img = new Image()
    img.onload = () => {
      const MAX_DIM = 360
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        done(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      done(canvas.toDataURL("image/jpeg", 0.82))
    }
    img.onerror = () => done(dataUrl)
    img.src = dataUrl
  }

  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const rawUrl = String(reader.result)
      compressAvatar(rawUrl, (compressedUrl) => {
        onPatch({ avatar: compressedUrl })
        onPushToast("Đã cập nhật ảnh đại diện")
      })
    }
    reader.readAsDataURL(f)
  }

  const compressBg = (dataUrl: string, done: (url: string) => void) => {
    const img = new Image()
    img.onload = () => {
      const MAX_DIM = 1200
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        done(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      done(canvas.toDataURL("image/jpeg", 0.75))
    }
    img.onerror = () => done(dataUrl)
    img.src = dataUrl
  }

  const pickBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      compressBg(String(reader.result), (compressed) => {
        onPatch({ bg: compressed })
      })
    }
    reader.readAsDataURL(f)
    onPushToast("Đã đổi ảnh nền đoạn chat")
  }

  const resetBg = () => {
    onPatch({ bg: undefined })
    setBgInput(null)
    onPushToast("Đã khôi phục nền mặc định")
  }

  const saveRename = () => {
    const v = renameVal.trim()
    if (!v) return
    onPatch({ name: v })
    setRenameOpen(false)
    onPushToast("Đã đổi tên đoạn chat")
  }

  const saveNick = () => {
    onPatch({ nicknames: { ...(conv.nicknames ?? {}), ...nickBuf } })
    setNickOpen(false)
    onPushToast("Đã cập nhật biệt danh")
  }

  const saveNickOne = () => {
    onPatch({ nicknames: { ...(conv.nicknames ?? {}), ...nickBuf } })
    setNickOpen(false)
    onPushToast("Đã cập nhật biệt danh")
  }

  const headerRow = (title: string, key: string, extra?: React.ReactNode) => (
    <button
      onClick={() => toggle(key)}
      className="w-full flex items-center justify-between px-4 py-3 text-left"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </span>
      <span className="flex items-center gap-2">
        {extra}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: "var(--muted)",
            transform: open[key] ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </button>
  )

  if (subView === "group_settings") {
    return (
      <div
        className="min-w-[320px] w-[360px] md:w-[360px] max-xl:w-[320px] max-xl:min-w-[300px] max-md:w-full max-md:fixed max-md:inset-0 max-md:z-50 flex-shrink-0 flex flex-col overflow-hidden animate-panel"
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        <GroupSettingsView
          conv={conv}
          myMemberId={myMemberId}
          onBack={() => setSubView("none")}
          onNavigate={(v) => setSubView(v)}
          onPushToast={onPushToast}
          onPatch={onPatch}
          onLeaveRoom={onLeaveRoom}
        />
      </div>
    )
  }

  if (subView === "members") {
    return (
      <div
        className="min-w-[320px] w-[360px] md:w-[360px] max-xl:w-[320px] max-xl:min-w-[300px] max-md:w-full max-md:fixed max-md:inset-0 max-md:z-50 flex-shrink-0 flex flex-col overflow-hidden animate-panel"
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        <GroupMembersView
          conv={conv}
          myMemberId={myMemberId}
          friendCandidates={friendCandidates}
          onBack={() => setSubView("none")}
          onPushToast={onPushToast}
          onRefreshRoom={() => onPatch({})}
          onViewMember={onViewMember}
          onAddMembers={onAddMembers}
        />
      </div>
    )
  }

  if (subView === "join_requests" && conv.realId) {
    return (
      <div
        className="min-w-[320px] w-[360px] md:w-[360px] max-xl:w-[320px] max-xl:min-w-[300px] max-md:w-full max-md:fixed max-md:inset-0 max-md:z-50 flex-shrink-0 flex flex-col overflow-hidden animate-panel"
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        <GroupJoinRequestsView
          roomId={conv.realId}
          onBack={() => setSubView("group_settings")}
          onPushToast={onPushToast}
          onRefreshRoom={() => onPatch({})}
        />
      </div>
    )
  }

  if (subView === "roles") {
    return (
      <div
        className="min-w-[320px] w-[360px] md:w-[360px] max-xl:w-[320px] max-xl:min-w-[300px] max-md:w-full max-md:fixed max-md:inset-0 max-md:z-50 flex-shrink-0 flex flex-col overflow-hidden animate-panel"
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        <GroupRolesView
          conv={conv}
          myMemberId={myMemberId}
          onBack={() => setSubView("group_settings")}
          onPushToast={onPushToast}
          onRefreshRoom={() => onPatch({})}
        />
      </div>
    )
  }

  if (subView === "blocks" && conv.realId) {
    return (
      <div
        className="min-w-[320px] w-[360px] md:w-[360px] max-xl:w-[320px] max-xl:min-w-[300px] max-md:w-full max-md:fixed max-md:inset-0 max-md:z-50 flex-shrink-0 flex flex-col overflow-hidden animate-panel"
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        <GroupBlocksView
          roomId={conv.realId}
          onBack={() => setSubView("group_settings")}
          onPushToast={onPushToast}
        />
      </div>
    )
  }

  return (
    <>
      <div
        className="min-w-[320px] w-[360px] md:w-[360px] max-xl:w-[320px] max-xl:min-w-[300px] max-md:w-[320px] max-md:min-w-0 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:shadow-2xl flex-shrink-0 flex flex-col overflow-hidden animate-panel"
        style={{
          borderLeft: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Thông tin đoạn chat
          </p>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
          >
            <svg
              width="16"
              height="16"
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

        <div className="flex-1 overflow-y-auto">
          {/* Group identity header */}
          <div
            className="flex flex-col items-center gap-2 py-5 px-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {isGroup ? (
              conv.avatar ? (
                <Avatar
                  src={conv.avatar}
                  name={conv.name}
                  sizePx={64}
                  showPresence={false}
                />
              ) : (
                <AvatarStack members={conv.members ?? []} max={4} />
              )
            ) : (
              <div className="flex flex-col items-center">
                <Avatar
                  initials={conv.initials}
                  online={conv.online}
                  src={conv.avatar}
                />
              </div>
            )}
            <p
              className="text-sm font-semibold text-center"
              style={{ color: "var(--text)" }}
            >
              {conv.nicknames?.[(myMemberId as number)] ??
                (isGroup ? conv.name : (conv.nickname ?? conv.name))}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {isGroup
                ? `${conv.members?.length ?? 0} thành viên`
                : presenceText(conv.online)}
            </p>
            {isGroup && (
              <div className="w-full flex items-center justify-center gap-2 pt-1">
                <button
                  onClick={() => setSubView("members")}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-85"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                  title="Danh sách và phân quyền thành viên"
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
                    style={{ color: "var(--primary)" }}
                  >
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87" />
                    <path d="M16 3.13a4 4 0 010 7.75" />
                  </svg>
                  <span>Thành viên</span>
                </button>
                <button
                  onClick={() => setSubView("group_settings")}
                  className="relative flex-1 flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-85"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                  title="Cài đặt quản lý nhóm"
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
                    style={{ color: "var(--primary)" }}
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                  <span>Quản lý nhóm</span>
                  {!!conv.pending_join_requests_count &&
                    conv.pending_join_requests_count > 0 && (
                      <span
                        className="px-1.5 py-0.2 rounded-full text-[10px] font-bold"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        {conv.pending_join_requests_count}
                      </span>
                    )}
                </button>
              </div>
            )}
          </div>

          {/* 1. Tùy chỉnh đoạn chat */}
          {headerRow("Tùy chỉnh đoạn chat", "custom")}
          {open.custom && (
            <div className="px-4 py-2 flex flex-col gap-1">
              {isGroup && (
                <>
                  {/* Đổi tên */}
                  {renameOpen ? (
                    <div className="flex items-center gap-2 py-1.5">
                      <input
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1.5 text-sm rounded-md outline-none"
                        style={{
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--border)",
                          color: "var(--text)",
                        }}
                        autoFocus
                      />
                      <button
                        onClick={saveRename}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-md"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Lưu
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setRenameVal(conv.name)
                        setRenameOpen(true)
                      }}
                      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-left"
                      style={{ color: "var(--text)" }}
                    >
                      <span style={{ color: "var(--primary)" }}>
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </span>
                      <span className="text-sm">Đổi tên đoạn chat</span>
                    </button>
                  )}

                  {/* Thay đổi ảnh */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      avatarInput?.click()
                    }}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-left"
                    style={{ color: "var(--text)" }}
                  >
                    <span style={{ color: "var(--primary)" }}>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect
                          x="3"
                          y="3"
                          width="18"
                          height="18"
                          rx="2"
                          ry="2"
                        />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </span>
                    <span className="text-sm">Thay đổi ảnh</span>
                  </button>
                  <input
                    ref={setAvatarInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={pickAvatar}
                  />
                </>
              )}

              {/* Đổi ảnh nền đoạn chat */}
              <div className="relative">
                {bgMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={(e) => {
                        e.stopPropagation()
                        setBgMenuOpen(false)
                      }}
                    />
                    <div
                      className="absolute top-full left-2 right-2 mt-1 rounded-xl shadow-lg py-1.5 z-50"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setBgMenuOpen(false)
                          bgInput?.click()
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left"
                        style={{ color: "var(--text)" }}
                      >
                        <span style={{ color: "var(--primary)" }}>
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect
                              x="3"
                              y="3"
                              width="18"
                              height="18"
                              rx="2"
                              ry="2"
                            />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </span>
                        Đổi ảnh nền
                      </button>
                      {conv.bg && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setBgMenuOpen(false)
                            resetBg()
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left"
                          style={{ color: "var(--error)" }}
                        >
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                          Khôi phục mặc định
                        </button>
                      )}
                    </div>
                  </>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setBgMenuOpen((v) => !v)
                  }}
                  className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-left"
                  style={{ color: "var(--text)" }}
                >
                  <span style={{ color: "var(--primary)" }}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </span>
                  <span className="flex-1 text-sm flex items-center gap-2">
                    Đổi ảnh nền đoạn chat
                    {conv.bg && (
                      <span
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{
                          border: "1px solid var(--border)",
                          backgroundImage: `url(${conv.bg})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }}
                      />
                    )}
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
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <input
                  ref={setBgInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={pickBg}
                />
              </div>

              {/* Đổi chủ đề */}
              <div>
                {themeOpen ? (
                  <div className="px-2 py-2.5 flex items-center gap-2 flex-wrap">
                    {THEME_COLORS.map((t) => (
                      <button
                        key={t.color}
                        onClick={() => {
                          onPatch({ theme: t.color })
                          setThemeOpen(false)
                          onPushToast("Đã đổi chủ đề đoạn chat")
                        }}
                        className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                        style={{
                          backgroundColor: t.color,
                          outline:
                            conv.theme === t.color
                              ? "2px solid var(--text)"
                              : "none",
                          outlineOffset: 1,
                        }}
                        title={t.color}
                      />
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => setThemeOpen(true)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-left"
                    style={{ color: "var(--text)" }}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full"
                      style={{
                        backgroundColor: conv.theme ?? "var(--primary)",
                      }}
                    />
                    <span className="text-sm">Đổi chủ đề</span>
                  </button>
                )}
              </div>

              {/* Thay đổi biểu tượng cảm xúc */}
              <div>
                {emojiOpen ? (
                  <div className="px-2 py-2.5 grid grid-cols-6 gap-1.5">
                    {EMOJI_CHOICE.map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          onPatch({ favEmoji: e })
                          setEmojiOpen(false)
                          onPushToast(`Đã đặt ${e} làm biểu tượng cảm xúc`)
                        }}
                        className="text-xl hover:scale-125 transition-transform"
                        style={{
                          filter:
                            conv.favEmoji === e ? "none" : "grayscale(0.4)",
                          opacity: conv.favEmoji === e ? 1 : 0.7,
                        }}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => setEmojiOpen(true)}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-left"
                    style={{ color: "var(--text)" }}
                  >
                    <span className="text-base w-3.5 flex justify-center">
                      {conv.favEmoji ?? "👍"}
                    </span>
                    <span className="text-sm">Biểu tượng cảm xúc</span>
                  </button>
                )}
              </div>

              {/* Chỉnh sửa biệt danh */}
              <div>
                {nickOpen ? (
                  <div className="px-2 py-2.5 flex flex-col gap-2">
                    {isGroup ? (
                      (conv.members ?? []).map((m) => (
                        <div key={m.id} className="flex items-center gap-2">
                          <span
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                            style={{
                              backgroundColor: "var(--surface)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                            }}
                          >
                            {m.initials}
                          </span>
                          <input
                            value={
                              nickBuf[m.id] ?? conv.nicknames?.[m.id] ?? m.name
                            }
                            onChange={(e) =>
                              setNickBuf((prev) => ({
                                ...prev,
                                [m.id]: e.target.value,
                              }))
                            }
                            placeholder={m.name}
                            className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-md outline-none"
                            style={{
                              backgroundColor: "var(--surface)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                            }}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2">
                        <Avatar
                          initials={conv.initials}
                          online={conv.online}
                          size="sm"
                          src={conv.avatar}
                        />
                        <input
                          value={nickBuf[1] ?? conv.nicknames?.[1] ?? conv.name}
                          onChange={(e) => setNickBuf({ 1: e.target.value })}
                          placeholder={conv.name}
                          className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-md outline-none"
                          style={{
                            backgroundColor: "var(--surface)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                          }}
                        />
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setNickOpen(false)}
                        className="px-2.5 py-1.5 text-xs rounded-md"
                        style={{ color: "var(--muted)" }}
                      >
                        Huỷ
                      </button>
                      <button
                        onClick={isGroup ? saveNick : saveNickOne}
                        className="px-2.5 py-1.5 text-xs font-semibold rounded-md"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Lưu
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setNickBuf({})
                      setNickOpen(true)
                    }}
                    className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-left"
                    style={{ color: "var(--text)" }}
                  >
                    <span style={{ color: "var(--primary)" }}>
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="4" y1="20" x2="20" y2="4" />
                        <line x1="4" y1="20" x2="12" y2="20" />
                        <line x1="4" y1="20" x2="4" y2="17" />
                        <circle cx="14" cy="10" r="3" />
                      </svg>
                    </span>
                    <span className="text-sm">Chỉnh sửa biệt danh</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 2. Thành viên (chỉ group) */}
          {isGroup && (
            <>
              {headerRow("Thành viên trong đoạn chat", "members")}
              {open.members && (
                <div
                  className="flex flex-col py-1"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <button
                    onClick={() => setAddMemberOpen((v) => !v)}
                    className="mx-4 my-2 px-3 py-2 text-xs font-medium rounded-lg text-left"
                    style={{
                      backgroundColor: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    + Thêm thành viên
                  </button>
                  {addMemberOpen && (
                    <div className="px-4 pb-2 flex flex-col gap-1">
                      <div className="relative mb-1">
                        <svg
                          className="absolute left-2.5 top-1/2 -translate-y-1/2"
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
                          value={addQuery}
                          onChange={(e) => setAddQuery(e.target.value)}
                          placeholder="Tìm bạn bè..."
                          className="w-full pl-8 pr-3 py-2 text-sm rounded-md outline-none"
                          style={{
                            backgroundColor: "var(--surface)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                          }}
                        />
                      </div>
                      {addFiltered.length === 0 ? (
                        <p
                          className="text-xs py-1"
                          style={{ color: "var(--muted)" }}
                        >
                          Không có ai để thêm
                        </p>
                      ) : (
                        <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto">
                          {addFiltered.map((f) => {
                            const checked = addSel.includes(f.id)
                            return (
                              <button
                                key={f.id}
                                onClick={() => toggleAddSel(f.id)}
                                className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:opacity-80"
                              >
                                <span
                                  className="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0"
                                  style={{
                                    borderColor: "var(--primary)",
                                    backgroundColor: checked
                                      ? "var(--primary)"
                                      : "transparent",
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
                                <Avatar
                                  initials={f.initials}
                                  online={f.online}
                                  size="sm"
                                  src={f.avatar}
                                />
                                <span
                                  className="text-sm truncate"
                                  style={{ color: "var(--text)" }}
                                >
                                  {f.name}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <button
                        onClick={handleAddMembers}
                        disabled={addSel.length === 0}
                        className="mt-1 px-3 py-2 text-xs font-semibold rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Thêm người
                        {addSel.length > 0 ? ` (${addSel.length})` : ""}
                      </button>
                    </div>
                  )}
                  {(conv.members ?? []).map((m) => {
                    const isAdmin = admins.includes(m.id)
                    const isMe = m.id === myMemberId
                    const shownName = conv.nicknames?.[m.id] ?? m.name
                    return (
                      <div
                        key={m.id}
                        className={`relative flex items-center gap-3 px-4 py-2.5 ${
                          !isMe
                            ? "cursor-pointer hover:bg-[var(--surface)] transition-colors"
                            : ""
                        }`}
                        onClick={!isMe ? () => onViewMember(m) : undefined}
                      >
                        <Avatar
                          sizePx={32}
                          src={m.avatar}
                          name={m.name}
                          initials={m.initials}
                          online={m.online}
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: "var(--text)" }}
                          >
                            {shownName}
                          </p>
                        </div>
                        {isAdmin && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{
                              backgroundColor: "var(--surface)",
                              color: "var(--muted)",
                              border: "1px solid var(--border)",
                            }}
                          >
                            Trưởng nhóm
                          </span>
                        )}
                        {!isMe && isSelfAdmin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setMemberMenu((cur) =>
                                cur === m.id ? null : m.id,
                              )
                            }}
                            className="p-1 rounded flex-shrink-0 transition-opacity hover:opacity-70"
                            style={{ color: "var(--muted)" }}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <circle cx="6" cy="12" r="1.6" />
                              <circle cx="12" cy="12" r="1.6" />
                              <circle cx="18" cy="12" r="1.6" />
                            </svg>
                          </button>
                        )}
                        {memberMenu === m.id && (
                          <div
                            className="absolute right-3 top-full mt-1 w-44 rounded-lg shadow-lg py-1 z-50"
                            style={{
                              backgroundColor: "var(--surface)",
                              border: "1px solid var(--border)",
                            }}
                          >
                            <button
                              onClick={() => {
                                onToggleAdmin(m.id)
                                setMemberMenu(null)
                              }}
                              className="w-full text-left px-3 py-2 text-sm"
                              style={{ color: "var(--text)" }}
                            >
                              {isAdmin
                                ? "Gỡ Trưởng nhóm"
                                : "Đặt làm Trưởng nhóm"}
                            </button>
                            <button
                              onClick={() => {
                                setMemberMenu(null)
                                setConfirm({
                                  title: "Xoá khỏi nhóm",
                                  message: `Xoá ${shownName} khỏi nhóm?`,
                                  label: "Xoá",
                                  onConfirm: () => onRemoveMember(m.id),
                                })
                              }}
                              className="w-full text-left px-3 py-2 text-sm"
                              style={{ color: "var(--error)" }}
                            >
                              Xoá khỏi nhóm
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* 4. Media / Files / Links */}
          {headerRow(
            isGroup ? "File, phương tiện và liên kết" : "File và phương tiện",
            "media",
          )}
          {open.media && (
            <div
              className="flex flex-col gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex gap-1">
                {(["media", "files", "links"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="px-2.5 py-1 text-xs rounded-md flex-1 font-medium"
                    style={{
                      backgroundColor:
                        tab === t ? "var(--surface)" : "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    {t === "media"
                      ? "Ảnh & Video"
                      : t === "files"
                        ? "File"
                        : "Link"}
                  </button>
                ))}
              </div>
              {tab === "media" &&
                (images.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: "var(--muted)" }}>
                    Chưa có ảnh nào
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {images.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => onOpenLightbox(m.id)}
                        className="aspect-square rounded-lg overflow-hidden"
                        style={{
                          backgroundColor: "#111",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <img
                          src={m.file!.url}
                          alt={m.file!.name}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ))}
              {tab === "files" &&
                (files.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: "var(--muted)" }}>
                    Chưa có file nào
                  </p>
                ) : (
                  files.slice(0, 10).map((m) => (
                    <div key={m.id} className="flex items-center gap-2 py-1">
                      <span
                        className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: "var(--surface)",
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
                          style={{ color: "var(--muted)" }}
                        >
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-xs truncate"
                          style={{ color: "var(--text)" }}
                        >
                          {m.file!.name}
                        </p>
                        <p
                          className="text-[10px]"
                          style={{ color: "var(--muted)" }}
                        >
                          {m.file!.size}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          onDownloadFile
                            ? onDownloadFile(m)
                            : downloadFile(m.file!.url, m.file!.name)
                        }
                        className="px-2 py-1 text-[10px] rounded-md transition-opacity hover:opacity-70"
                        style={{ color: "var(--muted)" }}
                      >
                        Tải
                      </button>
                    </div>
                  ))
                ))}
              {tab === "links" &&
                (links.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: "var(--muted)" }}>
                    Chưa có liên kết nào
                  </p>
                ) : (
                  links.map((l, i) => (
                    <a
                      key={i}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs truncate"
                      style={{ color: "var(--primary)" }}
                    >
                      {l.url}
                    </a>
                  ))
                ))}
            </div>
          )}

          {/* 5. Quyền riêng tư và hỗ trợ */}
          {headerRow("Quyền riêng tư và hỗ trợ", "privacy")}
          {open.privacy && (
            <div className="px-4 py-2 flex flex-col gap-1">
              <div className="flex items-center justify-between py-2">
                <span className="text-sm" style={{ color: "var(--text)" }}>
                  Tắt thông báo
                </span>
                <Toggle
                  value={!!conv.muted}
                  onChange={() => {
                    onPatch({ muted: !conv.muted })
                    onPushToast(
                      conv.muted
                        ? "Đã bật thông báo"
                        : "Đã tắt thông báo cho đoạn chat này",
                    )
                  }}
                />
              </div>
              {isGroup ? (
                <button
                  onClick={() =>
                    setConfirm({
                      title: "Rời phòng",
                      message: `Bạn có chắc muốn rời khỏi "${conv.name}"?`,
                      label: "Rời phòng",
                      onConfirm: onLeaveRoom,
                    })
                  }
                  className="w-full text-left px-2 py-2.5 text-sm"
                  style={{ color: "var(--error)" }}
                >
                  Rời phòng
                </button>
              ) : (
                <>
                  <button
                    onClick={() =>
                      setConfirm({
                        title: "Xoá đoạn chat",
                        message: `Xoá toàn bộ đoạn chat với ${conv.name}? Chỉ xoá ở phía bạn.`,
                        label: "Xoá",
                        onConfirm: onDeleteChat,
                      })
                    }
                    className="w-full text-left px-2 py-2.5 text-sm"
                    style={{ color: "var(--error)" }}
                  >
                    Xoá đoạn chat
                  </button>
                  {conv.blocked ? (
                    <button
                      onClick={onUnblock}
                      className="w-full text-left px-2 py-2.5 text-sm font-medium"
                      style={{ color: "var(--primary)" }}
                    >
                      Bỏ chặn người dùng
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setConfirm({
                          title: "Chặn người dùng",
                          message: `Bạn có chắc muốn chặn ${conv.name}? Bạn sẽ không nhận được tin nhắn hay cuộc gọi từ người này.`,
                          label: "Chặn",
                          onConfirm: onBlock,
                        })
                      }
                      className="w-full text-left px-2 py-2.5 text-sm"
                      style={{ color: "var(--error)" }}
                    >
                      Chặn người dùng
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => setReportOpen(true)}
                className="w-full text-left px-2 py-2.5 text-sm"
                style={{ color: "var(--muted)" }}
              >
                Báo cáo sự cố
              </button>
            </div>
          )}

          <div className="h-4" />
        </div>
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-full max-w-xs rounded-xl p-5 shadow-xl"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {confirm.title}
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
              {confirm.message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="px-3.5 py-1.5 text-sm rounded-md"
                style={{ color: "var(--muted)" }}
              >
                Huỷ
              </button>
              <button
                onClick={() => {
                  confirm.onConfirm()
                  setConfirm(null)
                }}
                className="px-3.5 py-1.5 text-sm font-semibold rounded-md"
                style={{
                  backgroundColor: "var(--error)",
                  color: "#fff",
                }}
              >
                {confirm.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report dialog */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setReportOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl p-5 shadow-xl"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="text-sm font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              {isGroup ? `Báo cáo nhóm "${conv.name}"` : `Báo cáo ${conv.name}`}
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
              Vui lòng mô tả lý do vi phạm.
            </p>
            <textarea
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              rows={3}
              placeholder="Mô tả vi phạm..."
              className="w-full px-2.5 py-2 text-sm rounded-md outline-none resize-none"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setReportOpen(false)}
                className="px-3.5 py-1.5 text-sm rounded-md"
                style={{ color: "var(--muted)" }}
              >
                Huỷ
              </button>
              <button
                onClick={() => {
                  onReport()
                  setReportText("")
                  setReportOpen(false)
                }}
                className="px-3.5 py-1.5 text-sm font-semibold rounded-md"
                style={{
                  backgroundColor: "var(--error)",
                  color: "#fff",
                }}
              >
                Gửi báo cáo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export { InfoPanel as ChatInfoPanel };
