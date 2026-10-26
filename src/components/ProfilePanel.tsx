import { useEffect, useRef, useState } from "react"
import { api, type ApiPublicUser, type Relation } from "../lib/api"
import { RelationActions } from "./RelationActions"
import {
  BUILTIN_RINGTONES,
  loadRingtoneConfig,
  saveRingtoneConfig,
  setCustomRingtoneFile,
  initRingtone,
  previewRingtone,
  stopAllRingtones,
  type RingtoneConfig,
} from "../lib/ringtone"

export interface ProfileData {
  name: string
  initials: string
  status: string
  email: string
  phone: string
  role: "Người dùng" | "Kiểm duyệt viên" | "Quản trị viên"
  joinDate: string
  birthdate: string
  birthdateISO?: string
  cover?: string
  avatar?: string
}

interface BlockedUser {
  id: number
  name: string
  initials: string
}

type View = "main" | "privacy" | "blocked" | "ringtone"

interface Props {
  mode: "self" | "other"
  profile: ProfileData
  publicId?: string
  online?: boolean
  initialRelation?: Relation
  initialRequestId?: number
  isBlocked?: boolean
  isFriend?: boolean
  phoneVisible?: boolean
  blockedUsers: BlockedUser[]
  onSave?: (p: ProfileData) => void
  onUnblock: (id: number, name: string) => void
  onChangePassword?: () => void
  onChangeEmail?: () => void
  onTogglePhonePublic?: () => void
  onMessage?: () => void
  onBlockUser?: () => void
  onFriendAccepted?: () => void
  onPushToast: (text: string) => void
  onClose: () => void
  phonePublic?: boolean
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase() || "??"
}

function formatMonthYear(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ""
  return `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}`
}

const ROLE_COLORS: Record<ProfileData["role"], { bg: string; fg: string }> = {
  "Người dùng": { bg: "var(--surface)", fg: "var(--muted)" },
  "Kiểm duyệt viên": { bg: "#e0f2fe", fg: "#0284c7" },
  "Quản trị viên": { bg: "#fef3c7", fg: "#b45309" },
}

function ChevronBack({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1 rounded-md transition-opacity hover:opacity-60"
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
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color: "var(--muted)" }}
    >
      {children}
    </p>
  )
}

function CropModal({
  src,
  onCancel,
  onConfirm,
}: {
  src: string
  onCancel: () => void
  onConfirm: (out: string) => void
}) {
  const BOX = 240
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{
    sx: number
    sy: number
    ox: number
    oy: number
  } | null>(null)

  const scale = dim ? Math.max(BOX / dim.w, BOX / dim.h) : 1
  const dispW = dim ? dim.w * scale * zoom : BOX
  const dispH = dim ? dim.h * scale * zoom : BOX

  const clampOffset = (o: { x: number; y: number }) => ({
    x: Math.min(0, Math.max(BOX - dispW, o.x)),
    y: Math.min(0, Math.max(BOX - dispH, o.y)),
  })

  const handleZoom = (z: number) => {
    setZoom(z)
    const dw = dim ? dim.w * Math.max(BOX / dim.w, BOX / dim.h) * z : BOX
    const dh = dim ? dim.h * Math.max(BOX / dim.w, BOX / dim.h) * z : BOX
    setOffset((o) => ({
      x: Math.min(0, Math.max(BOX - dw, o.x)),
      y: Math.min(0, Math.max(BOX - dh, o.y)),
    }))
  }

  const confirm = () => {
    const img = imgRef.current
    if (!img) return
    const canvas = document.createElement("canvas")
    canvas.width = BOX
    canvas.height = BOX
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(img, offset.x, offset.y, dispW, dispH)
    onConfirm(canvas.toDataURL("image/jpeg", 0.92))
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="w-full max-w-xs rounded-xl p-5"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-base font-semibold mb-4"
          style={{ color: "var(--text)" }}
        >
          Cắt ảnh đại diện
        </h3>

        <div
          className="relative mx-auto rounded-lg overflow-hidden select-none"
          style={{
            width: BOX,
            height: BOX,
            backgroundColor: "var(--surface)",
            cursor: "grab",
            touchAction: "none",
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = {
              sx: e.clientX,
              sy: e.clientY,
              ox: offset.x,
              oy: offset.y,
            }
          }}
          onPointerMove={(e) => {
            const d = dragRef.current
            if (!d) return
            setOffset(
              clampOffset({
                x: d.ox + (e.clientX - d.sx),
                y: d.oy + (e.clientY - d.sy),
              }),
            )
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onPointerLeave={() => {
            dragRef.current = null
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget
              setDim({ w, h })
              const s = Math.max(BOX / w, BOX / h)
              setOffset({
                x: -(w * s - BOX) / 2,
                y: -(h * s - BOX) / 2,
              })
            }}
            className="absolute max-w-none select-none"
            style={{
              left: offset.x,
              top: offset.y,
              width: dispW,
              height: dispH,
            }}
          />
        </div>

        <div className="flex items-center gap-3 px-1 mt-4">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-shrink-0"
            style={{ color: "var(--muted)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => handleZoom(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
          />
        </div>

        <div className="flex gap-3 mt-4">
          <button
            onClick={onCancel}
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
            onClick={confirm}
            className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
            }}
          >
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}

function RoleBadge({ role }: { role: ProfileData["role"] }) {
  const c = ROLE_COLORS[role]
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {role}
    </span>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative rounded-full transition-colors flex-shrink-0"
      style={{
        width: "40px",
        height: "22px",
        backgroundColor: value ? "var(--primary)" : "var(--border)",
      }}
    >
      <span
        className="absolute top-0.5 rounded-full transition-transform"
        style={{
          width: "18px",
          height: "18px",
          backgroundColor: value ? "var(--primary-fg)" : "#fff",
          left: "2px",
          transform: value ? "translateX(18px)" : "translateX(0)",
          transition: "transform 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  )
}

export function ProfilePanel({
  mode,
  profile,
  publicId,
  online,
  initialRelation,
  initialRequestId,
  isBlocked,
  isFriend,
  phoneVisible,
  blockedUsers,
  onSave,
  onUnblock,
  onChangePassword,
  onChangeEmail,
  onTogglePhonePublic,
  onMessage,
  onBlockUser,
  onFriendAccepted,
  onPushToast,
  onClose,
  phonePublic = true,
}: Props) {
  const [view, setView] = useState<View>("main")
  const [ringtoneConfig, setRingtoneConfig] = useState<RingtoneConfig>(loadRingtoneConfig)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const ringtoneFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      stopAllRingtones()
    }
  }, [])

  const handleSelectRingtone = (id: string) => {
    const updated = { ...ringtoneConfig, id }
    setRingtoneConfig(updated)
    saveRingtoneConfig({ id })
    if (previewingId) {
      previewRingtone(id, updated.customDataUrl, updated.volume)
      setPreviewingId(id)
    }
  }

  const handleTogglePreview = (id: string) => {
    if (previewingId === id) {
      stopAllRingtones()
      setPreviewingId(null)
    } else {
      previewRingtone(id, ringtoneConfig.customDataUrl, ringtoneConfig.volume)
      setPreviewingId(id)
    }
  }

  const handleVolumeChange = (vol: number) => {
    const updated = { ...ringtoneConfig, volume: vol }
    setRingtoneConfig(updated)
    saveRingtoneConfig({ volume: vol })
    if (previewingId) {
      previewRingtone(previewingId, ringtoneConfig.customDataUrl, vol)
    }
  }

  useEffect(() => {
    initRingtone().then((url) => {
      if (url) {
        setRingtoneConfig((prev) => ({ ...prev, customDataUrl: url }))
      }
    })
  }, [])

  const handleCustomAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      onPushToast?.("Vui lòng chọn file âm thanh nhỏ hơn 15MB")
      e.target.value = ""
      return
    }
    try {
      const audioUrl = await setCustomRingtoneFile(file)
      const updated: RingtoneConfig = {
        ...ringtoneConfig,
        id: "custom",
        customDataUrl: audioUrl,
        customName: file.name,
      }
      setRingtoneConfig(updated)
      onPushToast?.(`Đã lưu nhạc chuông: ${file.name}`)
      previewRingtone("custom", audioUrl, updated.volume)
      setPreviewingId("custom")
    } catch {
      onPushToast?.("Không thể lưu file nhạc chuông. Vui lòng thử lại")
    } finally {
      e.target.value = ""
    }
  }
  const [saved, setSaved] = useState<ProfileData>(profile)
  const [draft, setDraft] = useState<ProfileData>(profile)
  const [editingName, setEditingName] = useState(false)
  const [nameBuf, setNameBuf] = useState(profile.name)
  const [editingStatus, setEditingStatus] = useState(false)
  const [statusBuf, setStatusBuf] = useState(profile.status)
  const [phoneError, setPhoneError] = useState("")
  const [saving, setSaving] = useState(false)
  const [confirmUnsaved, setConfirmUnsaved] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const selfMode = mode === "self"

  const [remote, setRemote] = useState<ApiPublicUser | null>(null)
  const [loadingOther, setLoadingOther] = useState(false)
  const [otherError, setOtherError] = useState("")
  const [relation, setRelation] = useState<Relation>(
    initialRelation ?? (isFriend ? "friend" : "none"),
  )
  const [requestId, setRequestId] = useState<number | undefined>(
    initialRequestId,
  )

  useEffect(() => {
    if (selfMode || !publicId) return
    let alive = true
    setLoadingOther(true)
    setOtherError("")
    api.userByPublicId(publicId).then((r) => {
      if (!alive) return
      setLoadingOther(false)
      if (!r.ok || !r.data?.user) {
        setOtherError(
          r.status === 404
            ? "Không tìm thấy người dùng này."
            : "Không tải được hồ sơ, thử lại sau.",
        )
        return
      }
      setRemote(r.data.user)
      setRelation(r.data.user.relation)
      setRequestId(r.data.user.request_id)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfMode, publicId])

  const displayName = selfMode
    ? draft.name
    : remote?.display_name || profile.name
  const displayInitials = selfMode
    ? draft.initials
    : remote
      ? initialsOf(remote.display_name)
      : profile.initials
  const displayAvatar = selfMode ? draft.avatar : remote?.avatar || profile.avatar
  const displayCover = selfMode ? draft.cover : remote?.cover || profile.cover
  const displayStatus = selfMode ? draft.status : remote?.bio || profile.status || ""
  const isOnline = selfMode ? true : (remote?.online ?? online ?? false)
  const otherJoinDate = remote?.created_at
    ? formatMonthYear(remote.created_at)
    : ""

  const dirty =
    saved.name !== draft.name ||
    saved.status !== draft.status ||
    saved.phone !== draft.phone ||
    saved.birthdateISO !== draft.birthdateISO ||
    saved.avatar !== draft.avatar ||
    saved.cover !== draft.cover

  const setCover = (url: string | undefined) =>
    setDraft((d) => ({ ...d, cover: url }))

  const setAvatar = (url: string) => setDraft((d) => ({ ...d, avatar: url }))

  const readFile = (file: File, done: (url: string) => void) => {
    const reader = new FileReader()
    reader.onload = () => done(reader.result as string)
    reader.readAsDataURL(file)
  }

  const compressCover = (dataUrl: string, done: (url: string) => void) => {
    const img = new Image()
    img.onload = () => {
      const MAX_W = 1600
      const scale = Math.min(1, MAX_W / img.width)
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
      done(canvas.toDataURL("image/jpeg", 0.85))
    }
    img.onerror = () => done(dataUrl)
    img.src = dataUrl
  }

  const validPhone = (() => {
    const n = draft.phone.replace(/[\s\-().]/g, "")
    if (!n) return true
    return /^\+?\d{9,12}$/.test(n)
  })()

  const tryClose = () => {
    stopAllRingtones()
    setPreviewingId(null)
    if (selfMode && dirty && !saving) setConfirmUnsaved(true)
    else onClose()
  }

  const handleSave = () => {
    if (!validPhone) {
      setPhoneError("Số điện thoại không hợp lệ.")
      return
    }
    setSaving(true)
    window.setTimeout(() => {
      const next = { ...draft }
      next.name = nameBuf.trim() || next.name
      next.status = statusBuf.trim()
      setDraft(next)
      setSaved(next)
      setEditingName(false)
      setEditingStatus(false)
      setSaving(false)
      onSave?.(next)
      onPushToast("Đã cập nhật hồ sơ")
    }, 900)
  }

  const phoneDisplay = selfMode
    ? draft.phone || "Chưa có số điện thoại"
    : profile.phone

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
        onClick={tryClose}
      />

      <div
        className="absolute right-0 top-0 h-full w-[380px] max-w-[94vw] flex flex-col animate-panel-always"
        style={{
          backgroundColor: "var(--bg)",
          borderLeft: "1px solid var(--border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 h-14 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {view === "main" ? (
            <>
              <h2
                className="text-base font-semibold"
                style={{ color: "var(--text)" }}
              >
                {selfMode ? "Hồ sơ cá nhân" : "Hồ sơ"}
              </h2>
              <button
                onClick={tryClose}
                className="p-1 rounded-md transition-opacity hover:opacity-60"
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
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <ChevronBack onClick={() => { stopAllRingtones(); setPreviewingId(null); setView("main"); }} />
                <h2
                  className="text-base font-semibold"
                  style={{ color: "var(--text)" }}
                >
                  {view === "privacy"
                    ? "Quyền riêng tư và hỗ trợ"
                    : view === "blocked"
                      ? "Danh sách đã chặn"
                      : "Nhạc chuông cuộc gọi"}
                </h2>
              </div>
              <button
                onClick={tryClose}
                className="p-1 rounded-md transition-opacity hover:opacity-60"
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
            </>
          )}
        </div>

        {view === "main" && (
          <>
            {/* Scroll body */}
            <div className="flex-1 overflow-y-auto">
              {/* Cover */}
              <div
                className="relative h-[170px] flex-shrink-0"
                style={{
                  background:
                    displayCover ??
                    "linear-gradient(135deg, var(--primary) 0%, color-mix(in srgb, var(--primary) 50%, var(--bg)) 100%)",
                }}
              >
                {displayCover && (
                  <img
                    src={displayCover}
                    alt="Ảnh bìa"
                    className="w-full h-full object-cover"
                  />
                )}

                {selfMode && (
                  <button
                    onClick={() => coverInputRef.current?.click()}
                    className="absolute bottom-3 right-3 w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                    style={{
                      backgroundColor: "var(--bg)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                    }}
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
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </button>
                )}

                {selfMode && draft.cover && (
                  <button
                    onClick={() => setCover(undefined)}
                    className="absolute bottom-3 right-14 px-2.5 py-1.5 text-xs font-medium rounded-md transition-opacity hover:opacity-70"
                    style={{
                      backgroundColor: "var(--bg)",
                      color: "var(--error)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    Xoá ảnh bìa
                  </button>
                )}

                {selfMode && (
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) readFile(f, (url) => compressCover(url, setCover))
                      e.target.value = ""
                    }}
                  />
                )}
              </div>

              {/* Avatar + name + status */}
              <div className="flex flex-col items-center -mt-12 px-6 pb-4">
                <div className="relative">
                  <div
                    className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center text-xl font-semibold"
                    style={{
                      backgroundColor: "var(--surface)",
                      border: "4px solid #fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                      color: "var(--text)",
                    }}
                  >
                    {displayAvatar ? (
                      <img
                        src={displayAvatar}
                        alt={displayName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      displayInitials
                    )}
                  </div>
                  {selfMode && (
                    <>
                      <button
                        onClick={() => avatarInputRef.current?.click()}
                        className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                          border: "3px solid var(--bg)",
                        }}
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
                        >
                          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      </button>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) readFile(f, setCropSrc)
                          e.target.value = ""
                        }}
                      />
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-2">
                  {selfMode && editingName ? (
                    <>
                      <input
                        autoFocus
                        value={nameBuf}
                        onChange={(e) => setNameBuf(e.target.value)}
                        maxLength={60}
                        className="text-lg font-semibold rounded-md px-2 py-1 outline-none w-44"
                        style={{
                          color: "var(--text)",
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--primary)",
                        }}
                      />
                      <button
                        onClick={() => {
                          if (nameBuf.trim()) {
                            setDraft((d) => ({ ...d, name: nameBuf.trim() }))
                            setEditingName(false)
                          }
                        }}
                        className="text-xs font-semibold px-2 py-1.5 rounded-md transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Lưu
                      </button>
                      <button
                        onClick={() => {
                          setNameBuf(saved.name)
                          setEditingName(false)
                        }}
                        className="text-xs font-medium px-2 py-1.5 rounded-md transition-opacity hover:opacity-70"
                        style={{
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        Huỷ
                      </button>
                    </>
                  ) : (
                    <>
                      <h3
                        className="text-xl font-semibold"
                        style={{ color: "var(--text)" }}
                      >
                        {displayName}
                      </h3>
                      {selfMode && (
                        <button
                          onClick={() => {
                            setNameBuf(draft.name)
                            setEditingName(true)
                          }}
                          className="p-1 rounded transition-opacity hover:opacity-60"
                          style={{ color: "var(--muted)" }}
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
                          >
                            <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-1">
                  {selfMode && editingStatus ? (
                    <>
                      <input
                        autoFocus
                        value={statusBuf}
                        onChange={(e) => setStatusBuf(e.target.value)}
                        maxLength={80}
                        className="text-sm rounded-md px-2 py-1 outline-none w-52"
                        style={{
                          color: "var(--muted)",
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--primary)",
                        }}
                      />
                      <button
                        onClick={() => {
                          setDraft((d) => ({ ...d, status: statusBuf.trim() }))
                          setEditingStatus(false)
                        }}
                        className="text-xs font-semibold px-2 py-1.5 rounded-md transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Lưu
                      </button>
                      <button
                        onClick={() => {
                          setStatusBuf(saved.status)
                          setEditingStatus(false)
                        }}
                        className="text-xs font-medium px-2 py-1.5 rounded-md transition-opacity hover:opacity-70"
                        style={{
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        Huỷ
                      </button>
                    </>
                  ) : (
                    <>
                      <p
                        className="text-sm"
                        style={{
                          color: "var(--muted)",
                          fontStyle: selfMode && !draft.status ? "italic" : undefined,
                        }}
                      >
                        {displayStatus || (selfMode ? "Thêm trạng thái..." : "")}
                      </p>
                      {selfMode && (
                        <button
                          onClick={() => {
                            setStatusBuf(draft.status)
                            setEditingStatus(true)
                          }}
                          className="p-1 rounded transition-opacity hover:opacity-60"
                          style={{ color: "var(--muted)" }}
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
                          >
                            <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
                {selfMode && editingStatus && (
                  <span
                    className="text-[11px] mt-0.5"
                    style={{ color: "var(--muted)" }}
                  >
                    {statusBuf.length}/80
                  </span>
                )}
                {!selfMode && !otherError && (
                  <span
                    className="flex items-center gap-1.5 text-sm mt-1"
                    style={{ color: "var(--muted)" }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: isOnline ? "#22c55e" : "var(--muted)",
                      }}
                    />
                    {loadingOther
                      ? "Đang tải hồ sơ..."
                      : isOnline
                        ? "Đang hoạt động"
                        : "Ngoại tuyến"}
                  </span>
                )}
                {!selfMode && otherError && (
                  <span className="text-sm mt-1" style={{ color: "var(--error)" }}>
                    {otherError}
                  </span>
                )}
              </div>

              {/* Thông tin cơ bản */}
              <div
                className="px-5 pt-4 pb-5 flex flex-col gap-4"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <SectionLabel>Thông tin cơ bản</SectionLabel>

                {!selfMode && (displayStatus || remote?.bio) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      Tiểu sử
                    </span>
                    <span className="text-sm" style={{ color: "var(--text)" }}>
                      {displayStatus || remote?.bio}
                    </span>
                  </div>
                )}

                {selfMode && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      Email (dùng để đăng nhập)
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm"
                        style={{ color: "var(--text)" }}
                      >
                        {draft.email}
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
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </svg>
                    </div>
                  </div>
                )}

                {(selfMode || phoneDisplay) && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      Số điện thoại
                    </span>
                    {selfMode ? (
                      <input
                        value={draft.phone}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, phone: e.target.value }))
                          setPhoneError("")
                        }}
                        placeholder="Chưa có số điện thoại"
                        maxLength={15}
                        className="text-sm rounded-md px-2.5 py-2 outline-none"
                        style={{
                          color: "var(--text)",
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--border)",
                        }}
                      />
                    ) : (
                      <span
                        className="text-sm"
                        style={{ color: "var(--text)" }}
                      >
                        {phoneDisplay}
                      </span>
                    )}
                  {selfMode && !phonePublic && (
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      Chỉ mình bạn nhìn thấy số điện thoại này.
                    </span>
                  )}
                  {selfMode && phoneError && (
                    <span className="text-xs" style={{ color: "var(--error)" }}>
                      {phoneError}
                    </span>
                  )}
                  </div>
                )}

                {selfMode && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      Ngày sinh
                    </span>
                    <input
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      value={draft.birthdateISO ?? ""}
                      onChange={(e) => {
                        const v = e.target.value
                        setDraft((d) => ({
                          ...d,
                          birthdateISO: v,
                          birthdate: v ? v.split("-").reverse().join("/") : d.birthdate,
                        }))
                      }}
                      className="text-sm w-full rounded-lg px-3 py-2"
                      style={{
                        color: "var(--text)",
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                      }}
                    />
                  </div>
                )}
              </div>

              {(selfMode || otherJoinDate) && (
                <div
                  className="px-5 pt-4 pb-5 flex flex-col gap-4"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  {selfMode && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          Vai trò
                        </span>
                        <div className="flex items-center gap-2">
                          <RoleBadge role={draft.role} />
                        </div>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          Vai trò do quản trị viên gán.
                        </span>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          Ngày tham gia
                        </span>
                        <span className="text-sm" style={{ color: "var(--text)" }}>
                          Tham gia từ {draft.joinDate}
                        </span>
                      </div>
                    </>
                  )}

                  {!selfMode && otherJoinDate && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        Ngày tham gia
                      </span>
                      <span className="text-sm" style={{ color: "var(--text)" }}>
                        Tham gia từ {otherJoinDate}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {selfMode ? (
                <div
                  className="px-5 pt-4 pb-5 flex flex-col"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <div className="mb-2">
                    <SectionLabel>Lối tắt cài đặt</SectionLabel>
                  </div>
                  <LinkRow
                    icon={
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
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                      </svg>
                    }
                    label="Đổi mật khẩu"
                    onClick={() => onChangePassword?.()}
                  />
                  <LinkRow
                    icon={
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
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0110 0v4" />
                        <circle cx="12" cy="16.5" r="0.5" />
                      </svg>
                    }
                    label="Đổi tài khoản đăng nhập"
                    onClick={() => onChangeEmail?.()}
                  />
                  <LinkRow
                    icon={
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
                        <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
                      </svg>
                    }
                    label="Quyền riêng tư và hỗ trợ"
                    onClick={() => setView("privacy")}
                  />
                  <LinkRow
                    icon={
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
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    }
                    label="Nhạc chuông cuộc gọi"
                    onClick={() => setView("ringtone")}
                  />
                  <LinkRow
                    icon={
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
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    }
                    label="Danh sách đã chặn"
                    onClick={() => setView("blocked")}
                  />
                </div>
              ) : (
                <div
                  className="px-5 pt-4 pb-5 flex flex-col gap-2"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <SectionLabel>Thao tác</SectionLabel>

                  {isBlocked ? (
                    <button
                      onClick={() => onUnblock(-1, profile.name)}
                      className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      Bỏ chặn người dùng
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <RelationActions
                          relation={relation}
                          publicId={publicId}
                          requestId={requestId}
                          size="md"
                          onError={onPushToast}
                          onChange={(rel, rid) => {
                            setRelation(rel)
                            setRequestId(rid)
                            if (rel === "friend") {
                              onPushToast("Đã kết bạn")
                              onFriendAccepted?.()
                            } else if (rel === "pending_sent") {
                              onPushToast("Đã gửi lời mời kết bạn")
                            }
                          }}
                        />
                        {relation === "friend" && onMessage && (
                          <button
                            onClick={onMessage}
                            className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
                            style={{
                              backgroundColor: "var(--primary)",
                              color: "var(--primary-fg)",
                            }}
                          >
                            Nhắn tin
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="h-6" />
            </div>

            {/* Save footer */}
            {selfMode && (dirty || saving) && (
              <div
                className="px-4 py-3 flex-shrink-0"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-60"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  {saving ? "Đang lưu..." : "Lưu thay đổi"}
                </button>
              </div>
            )}
          </>
        )}

        {view === "privacy" && (
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 flex flex-col gap-4">
            <div className="flex items-start gap-2.5">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0 mt-0.5"
                style={{ color: "var(--muted)" }}
              >
                <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" />
              </svg>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Chọn thông tin nào của bạn được người khác nhìn thấy khi họ xem
                hồ sơ của bạn.
              </p>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex flex-col">
                <span className="text-sm" style={{ color: "var(--text)" }}>
                  Cho người khác xem số điện thoại
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  Tắt để mọi người chỉ thấy "Riêng tư"
                </span>
              </div>
              <Toggle
                value={phonePublic}
                onChange={() => onTogglePhonePublic?.()}
              />
            </div>

          </div>
        )}

        {view === "ringtone" && (
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6 flex flex-col gap-4">
            <div className="flex items-start gap-2.5">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0 mt-0.5"
                style={{ color: "var(--muted)" }}
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                Cài đặt nhạc chuông riêng cho máy này. Nhạc chuông sẽ tự động reo khi có cuộc gọi đến. Bạn có thể chọn giai điệu có sẵn hoặc tải bài hát từ máy tính của bạn.
              </p>
            </div>

            {/* Điều chỉnh âm lượng */}
            <div
              className="p-3.5 rounded-xl flex flex-col gap-2"
              style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between text-xs font-semibold" style={{ color: "var(--text)" }}>
                <span>Âm lượng chuông</span>
                <span>{Math.round(ringtoneConfig.volume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ringtoneConfig.volume}
                onChange={(e) => handleVolumeChange(Number.parseFloat(e.target.value))}
                className="w-full cursor-pointer accent-blue-600"
              />
            </div>

            {/* Danh sách nhạc chuông */}
            <div className="flex flex-col gap-2 mt-1">
              <span className="text-xs font-semibold tracking-wider uppercase px-1" style={{ color: "var(--muted)" }}>
                Danh sách giai điệu
              </span>

              {BUILTIN_RINGTONES.map((r) => {
                const isSelected = ringtoneConfig.id === r.id
                const isPlayingThis = previewingId === r.id
                return (
                  <div
                    key={r.id}
                    onClick={() => handleSelectRingtone(r.id)}
                    className="p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all hover:scale-[1.01]"
                    style={{
                      backgroundColor: isSelected ? "var(--accent-subtle, rgba(59, 130, 246, 0.08))" : "var(--surface)",
                      border: isSelected ? "1.5px solid var(--primary, #3b82f6)" : "1px solid var(--border)",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-2">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: isSelected ? "var(--primary, #3b82f6)" : "var(--bg)",
                          color: isSelected ? "#fff" : "var(--muted)",
                        }}
                      >
                        {isSelected ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          </svg>
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
                          {r.name}
                        </span>
                        <span className="text-xs truncate" style={{ color: "var(--muted)" }}>
                          {r.id === "custom" && ringtoneConfig.customName
                            ? `File: ${ringtoneConfig.customName}`
                            : r.desc}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {r.id === "custom" && (
                        <>
                          <button
                            type="button"
                            onClick={() => ringtoneFileInputRef.current?.click()}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg transition-colors hover:opacity-80"
                            style={{
                              backgroundColor: "var(--bg)",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                            }}
                          >
                            {ringtoneConfig.customDataUrl ? "Đổi file" : "Tải file"}
                          </button>
                          <input
                            ref={ringtoneFileInputRef}
                            type="file"
                            accept="audio/*,.mp3,.wav,.ogg,.m4a"
                            className="hidden"
                            onChange={handleCustomAudioUpload}
                          />
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() => handleTogglePreview(r.id)}
                        disabled={r.id === "custom" && !ringtoneConfig.customDataUrl}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 disabled:opacity-30 disabled:hover:scale-100"
                        style={{
                          backgroundColor: isPlayingThis ? "var(--primary, #3b82f6)" : "var(--bg)",
                          color: isPlayingThis ? "#fff" : "var(--text)",
                          border: "1px solid var(--border)",
                        }}
                        title={isPlayingThis ? "Dừng nghe thử" : "Nghe thử"}
                      >
                        {isPlayingThis ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16" />
                            <rect x="14" y="4" width="4" height="16" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {view === "blocked" && (
          <div className="flex-1 overflow-y-auto">
            {blockedUsers.length === 0 ? (
              <div className="px-5 py-10 flex flex-col items-center gap-2">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--muted)" }}
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Bạn chưa chặn ai.
                </p>
              </div>
            ) : (
              blockedUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-3 px-5 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                    style={{
                      backgroundColor: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  >
                    {u.initials}
                  </div>
                  <span
                    className="flex-1 text-sm truncate"
                    style={{ color: "var(--text)" }}
                  >
                    {u.name}
                  </span>
                  <button
                    onClick={() => {
                      onUnblock(u.id, u.name)
                    }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-fg)",
                    }}
                  >
                    Bỏ chặn
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Unsaved confirm */}
      {confirmUnsaved && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmUnsaved(false)
          }}
        >
          <div
            className="w-full max-w-xs rounded-xl p-5"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              className="text-sm font-semibold mb-1.5"
              style={{ color: "var(--text)" }}
            >
              Thay đổi chưa được lưu
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
              Bạn có thay đổi chưa lưu, thoát mà không lưu?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmUnsaved(false)}
                className="flex-1 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  backgroundColor: "var(--bg)",
                }}
              >
                Huỷ
              </button>
              <button
                onClick={() => {
                  setConfirmUnsaved(false)
                  onClose()
                }}
                className="flex-1 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--error)",
                  color: "#fff",
                }}
              >
                Thoát
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block confirm (other mode) */}
      {confirmBlock && !selfMode && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmBlock(false)
          }}
        >
          <div
            className="w-full max-w-xs rounded-xl p-5"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              className="text-sm font-semibold mb-1.5"
              style={{ color: "var(--text)" }}
            >
              Chặn người dùng
            </p>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
              Bạn sẽ không còn nhắn tin hoặc gọi 1-1 với {profile.name} được
              nữa.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmBlock(false)}
                className="flex-1 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  backgroundColor: "var(--bg)",
                }}
              >
                Huỷ
              </button>
              <button
                onClick={() => {
                  setConfirmBlock(false)
                  onBlockUser?.()
                }}
                className="flex-1 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: "var(--error)",
                  color: "#fff",
                }}
              >
                Chặn
              </button>
            </div>
          </div>
        </div>
      )}

      {cropSrc && (
        <CropModal
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onConfirm={(url) => {
            setAvatar(url)
            setCropSrc(null)
          }}
        />
      )}
    </div>
  )
}

function LinkRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 py-3 text-sm transition-opacity hover:opacity-70"
      style={{ color: "var(--text)" }}
    >
      <span style={{ color: "var(--muted)" }}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <svg
        width="15"
        height="15"
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
  )
}
