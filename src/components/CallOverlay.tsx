import { useEffect, useMemo, useRef, useState } from "react"
import { useDraggable } from "../lib/useDraggable"
import {
  type CallPerson,
  type CallDir,
  type CallKindView,
  type CallNetHint,
  type CallVisualState,
  INCOMING_AUTO_CLOSE_MS,
  callClockText,
  callLayout,
  callStatusWord,
  cameraToggleLabel,
  colorForName,
  endButtonLabel,
  glowScale,
  groupGridColumns,
  initialsOf,
  isIncomingRing,
  isReconnecting,
  isRinging,
  micAriaLabel,
  netHintLabel,
  participantCountLabel,
  pickActiveSpeaker,
} from "../lib/callView"
import { resolveAvatarUrl } from "../lib/avatarUrl"
import {
  usePersonAvatar,
  usePersonDirectory,
  useUserProfile,
} from "../lib/personDirectory"
import { Avatar } from "./Avatar"

/**
 * Màn hình cuộc gọi (chỉ giao diện).
 *
 * Nhận dữ liệu đã có sẵn từ Home (trạng thái gọi, stream, danh sách người, ảnh đại diện,
 * chất lượng mạng) và chỉ vẽ. KHÔNG chạm tới logic báo hiệu/WebRTC/E2E — mọi thao tác
 * đều gọi ngược qua callback do Home truyền vào.
 */
export interface CallOverlayCall {
  kind: CallKindView
  dir: CallDir
  state: CallVisualState
  name: string
  reason?: string
  startAt?: number
  finalDur?: number
  convId: number
  roomId?: number
  participants?: { userId: number; name: string }[]
  acked?: boolean
}

export interface CallOverlayProps {
  call: CallOverlayCall
  dur: number
  muted: boolean
  videoOff: boolean
  localStream: MediaStream | null
  remoteStreams: Record<number, MediaStream>
  /** Danh sách người để vẽ ảnh/lưới (đã gồm bản thân). Rỗng = suy ra từ call.participants. */
  roster?: CallPerson[]
  /** ẢNH KHÔNG NHẬN TỪ PROPS: mọi chỗ hiển thị tra theo userId trong thư viện
   * người dùng (personDirectory) — cùng nguồn với danh sách hội thoại/bạn. */
  /** Chất lượng mạng (biểu tượng + dải "Đang kết nối lại…"). */
  netHint?: CallNetHint
  /** Tổng số người trong cuộc gọi (đã gồm bản thân). */
  totalCount?: number
  /** Đang thu nhỏ thành thanh gọi nhỏ ở góc. */
  minimized?: boolean
  onToggleMinimize?: () => void
  onHangUp: () => void
  onAccept: () => void
  onRetry: () => void
  onToggleMute: () => void
  onToggleVideo: () => void
  /** Chọn micro (tuỳ chọn — nếu không truyền thì chỉ hiển thị danh sách thiết bị). */
  onSelectMicrophone?: (deviceId: string) => void
}

/* -------------------------------------------------------------------------- */
/* Tiện ích nhỏ                                                                */
/* -------------------------------------------------------------------------- */

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReduce(mq.matches)
    apply()
    mq.addEventListener?.("change", apply)
    return () => mq.removeEventListener?.("change", apply)
  }, [])
  return reduce
}

interface LevelTarget {
  id: number
  stream: MediaStream | null
  muted: boolean
}

/**
 * Mức âm lượng (0..1) cho từng nguồn, dùng Web Audio AnalyserNode.
 * - Một AudioContext dùng chung; cập nhật ~12,5 lần/giây (CPU thấp).
 * - Tôn trọng prefers-reduced-motion: khi bật thì không chạy vòng lặp (trả rỗng).
 * - Dọn sạch AnalyserNode/AudioContext khi unmount hoặc khi đổi nguồn.
 */
function useSpeakerLevels(
  remoteStreams: Record<number, MediaStream>,
  localStream: MediaStream | null,
  muted: boolean,
  enabled: boolean,
  reduceMotion: boolean,
): Record<number, number> {
  const ref = useRef<{ remoteStreams: Record<number, MediaStream>; localStream: MediaStream | null; muted: boolean }>({
    remoteStreams,
    localStream,
    muted,
  })
  ref.current = { remoteStreams, localStream, muted }

  const key = `${Object.keys(remoteStreams).sort().join(",")}|${localStream ? 1 : 0}|${muted ? 0 : 1}`
  const [levels, setLevels] = useState<Record<number, number>>({})

  useEffect(() => {
    if (!enabled || reduceMotion) {
      setLevels({})
      return
    }
    const AC =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined
    if (!AC) return
    let ctx: AudioContext
    try {
      ctx = new AC()
    } catch {
      return
    }
    const nodes: {
      id: number
      src: MediaStreamAudioSourceNode
      an: AnalyserNode
      data: Uint8Array<ArrayBuffer>
    }[] = []
    const targets: LevelTarget[] = []
    for (const id of Object.keys(ref.current.remoteStreams)) {
      targets.push({
        id: Number(id),
        stream: ref.current.remoteStreams[Number(id)],
        muted: false,
      })
    }
    if (ref.current.localStream && !ref.current.muted) {
      targets.push({ id: 0, stream: ref.current.localStream, muted: false })
    }
    for (const t of targets) {
      if (!t.stream) continue
      try {
        const src = ctx.createMediaStreamSource(t.stream)
        const an = ctx.createAnalyser()
        an.fftSize = 256
        an.smoothingTimeConstant = 0.8
        src.connect(an)
        nodes.push({ id: t.id, src, an, data: new Uint8Array(an.frequencyBinCount) })
      } catch {
        /* nguồn không hợp lệ — bỏ qua */
      }
    }
    if (nodes.length === 0) {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
      return
    }
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last >= 80) {
        last = now
        const next: Record<number, number> = {}
        for (const n of nodes) {
          n.an.getByteTimeDomainData(n.data)
          let sum = 0
          for (let i = 0; i < n.data.length; i += 1) {
            const v = (n.data[i] - 128) / 128
            sum += v * v
          }
          next[n.id] = Math.min(1, Math.sqrt(sum / n.data.length) * 3)
        }
        setLevels(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const n of nodes) {
        try {
          n.src.disconnect()
        } catch {
          /* ignore */
        }
        try {
          n.an.disconnect()
        } catch {
          /* ignore */
        }
      }
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
      setLevels({})
    }
  }, [key, enabled, reduceMotion])

  return levels
}

/* -------------------------------------------------------------------------- */
/* Stream helpers (chuyển từ Home — chỉ dùng cho màn hình gọi)                 */
/* -------------------------------------------------------------------------- */

export function CallStreamVideo({
  stream,
  muted,
  className,
  style,
}: {
  stream: MediaStream | null
  muted: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    return () => {
      if (el) el.srcObject = null
    }
  }, [stream])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={style}
    />
  )
}

export function CallStreamAudio({
  stream,
  sinkId,
  speakerOff,
}: {
  stream: MediaStream
  sinkId?: string
  speakerOff?: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream

    const tryPlay = () => {
      if (!el) return
      el.play().catch(() => {
        const unlock = () => {
          el?.play().catch(() => {})
          window.removeEventListener("click", unlock)
          window.removeEventListener("touchstart", unlock)
          window.removeEventListener("keydown", unlock)
        }
        window.addEventListener("click", unlock, { once: true })
        window.addEventListener("touchstart", unlock, { once: true })
        window.addEventListener("keydown", unlock, { once: true })
      })
    }
    tryPlay()

    return () => {
      if (el) el.srcObject = null
    }
  }, [stream])
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!el || !sinkId || typeof el.setSinkId !== "function") return
    el.setSinkId(sinkId).catch(() => {})
  }, [sinkId])
  return (
    <audio
      ref={ref}
      autoPlay
      playsInline
      muted={Boolean(speakerOff)}
      style={{
        position: "fixed",
        width: "1px",
        height: "1px",
        opacity: 0,
        pointerEvents: "none",
        clip: "rect(0,0,0,0)",
      }}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Nguyên tố giao diện                                                         */
/* -------------------------------------------------------------------------- */

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  )
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path d="M19 10v2a7 7 0 01-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

function CameraIcon({ off }: { off: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      <path d="M18.5 5.5a9 9 0 010 13" />
    </svg>
  )
}

function PhoneDownIcon({ big }: { big?: boolean }) {
  return (
    <svg width={big ? 26 : 22} height={big ? 26 : 22} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.27a16 16 0 006.29 6.29l1.63-1.34a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  )
}

function PhoneUpIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.27a16 16 0 006.29 6.29l1.63-1.34a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

function ItemButton({
  onClick,
  label,
  children,
  variant = "glass",
  disabled,
  pressed,
}: {
  onClick?: () => void
  label: string
  children: React.ReactNode
  variant?: "glass" | "danger" | "camera-off" | "mic-off"
  disabled?: boolean
  pressed?: boolean
}) {
  const bg =
    variant === "danger"
      ? "#ef4444"
      : variant === "mic-off"
        ? "rgba(239,68,68,0.92)"
        : variant === "camera-off"
          ? "rgba(239,68,68,0.92)"
          : "var(--call-glass)"
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      className="w-12 h-12 md:w-14 md:h-14 flex-shrink-0 rounded-full flex items-center justify-center transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 call-glass"
      style={{ backgroundColor: bg, color: "#fff" }}
    >
      {children}
    </button>
  )
}

function NetBadge({ hint }: { hint: CallNetHint }) {
  const color =
    hint === "good"
      ? "var(--call-good)"
      : hint === "weak"
        ? "var(--call-weak)"
        : "var(--call-down)"
  const bars = hint === "good" ? 3 : hint === "weak" ? 2 : 1
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full call-glass text-[11px] font-medium"
      title={netHintLabel(hint)}
      aria-label={`Chất lượng mạng: ${netHintLabel(hint)}`}
      style={{ color: "var(--call-fg)" }}
    >
      <span className="inline-flex items-end gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: 5 + i * 3,
              borderRadius: 1,
              backgroundColor: i < bars ? color : "rgba(255,255,255,0.28)",
            }}
          />
        ))}
      </span>
      {netHintLabel(hint)}
    </span>
  )
}

/** Ảnh đại diện tròn có blur-up; lỗi/không ảnh → chữ viết tắt + màu nền.
 *  Nguồn ảnh & tên: TRA THEO userId trong thư viện người dùng qua useUserProfile
 *  ngay lúc hiển thị (chưa có → chữ viết tắt, API trả về → tự chuyển sang ảnh, không reload). */
function CallAvatar({
  person,
  userId,
  fallbackName,
  fallbackAvatar,
  color,
  sizePx = 110,
  fontSize = 36,
  glow = 0,
  level = 0,
  className,
}: {
  person: CallPerson
  userId?: number
  fallbackName?: string
  fallbackAvatar?: string
  color?: string
  sizePx?: number
  fontSize?: number
  glow?: number
  level?: number
  speaking?: boolean
  className?: string
}) {
  const targetId = userId ?? person.userId
  const dirAvatar = usePersonAvatar({ id: person.userId }).avatar
  const profile = useUserProfile(targetId, {
    fallbackName: person.name || fallbackName,
  })
  const src = profile.avatarUrl || resolveAvatarUrl(person.avatar || fallbackAvatar) || dirAvatar
  const name = profile.displayName || person.name || fallbackName || ""
  const initials = profile.initials || person.initials || initialsOf(name)
  const avatarColor = color || person.color || colorForName(name)
  const effGlow = Math.max(glow, level)
  const glowStrength = glowScale(effGlow)
  const boxShadow =
    glowStrength > 0
      ? `0 0 0 ${Math.round(4 + glowStrength * 22)}px rgba(125,211,252,${(
          0.16 +
          glowStrength * 0.4
        ).toFixed(2)}), 0 0 70px rgba(125,211,252,${(glowStrength * 0.5).toFixed(2)})`
      : "none"
  return (
    <Avatar
      src={src}
      initials={initials}
      name={name}
      sizePx={sizePx}
      fontSizePx={fontSize}
      showPresence={false}
      className={`call-glow ${className ?? ""}`}
      style={{
        backgroundColor: avatarColor,
        color: "#fff",
        boxShadow,
        border: "2px solid rgba(255,255,255,0.35)",
      }}
    />
  )
}

function PersonTile({
  person,
  level,
  speaking,
}: {
  person: CallPerson
  level: number
  speaking: boolean
}) {
  const profile = useUserProfile(person.userId, {
    fallbackName: person.name,
  })
  const displayName = profile.displayName || person.name
  return (
    <div
      className="relative rounded-2xl call-glass flex items-center justify-center overflow-hidden transition-all duration-200"
      style={{
        aspectRatio: "16 / 10",
        maxHeight: "180px",
        minHeight: "110px",
        borderColor: speaking
          ? "rgba(125,211,252,0.9)"
          : "var(--call-glass-border)",
        boxShadow: speaking
          ? "0 0 0 2px rgba(125,211,252,0.7) inset"
          : "none",
      }}
    >
      <CallAvatar
        userId={person.userId}
        person={person}
        sizePx={56}
        fontSize={20}
        glow={speaking ? Math.max(level, 0.25) : level * 0.4}
      />
      <span
        className="absolute bottom-2 left-2 right-2 truncate text-xs font-medium px-2.5 py-1 rounded-full text-center bg-black/50 backdrop-blur-md border border-white/10"
        style={{ color: "var(--call-fg)" }}
        title={displayName}
      >
        {displayName}
        {person.muted ? " · tắt mic" : ""}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Thành phần chính                                                            */
/* -------------------------------------------------------------------------- */

/** Theo dõi trạng thái bật/tắt camera thực tế của từng peer từ xa */
function useRemoteVideoStatus(remoteStreams: Record<number, MediaStream> = {}): Record<number, boolean> {
  const [status, setStatus] = useState<Record<number, boolean>>({})

  useEffect(() => {
    const entries = Object.entries(remoteStreams ?? {})
    if (entries.length === 0) {
      setStatus((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    const update = () => {
      setStatus((prev) => {
        const next: Record<number, boolean> = {}
        let changed = false
        entries.forEach(([uid, st]) => {
          const vTracks = st ? st.getVideoTracks() : []
          const active = vTracks.some((t) => t.enabled && !t.muted && t.readyState === "live")
          next[Number(uid)] = active
          if (prev[Number(uid)] !== active) changed = true
        })
        if (Object.keys(prev).length !== Object.keys(next).length) changed = true
        return changed ? next : prev
      })
    }
    update()
    const cleanups: (() => void)[] = []
    entries.forEach(([, st]) => {
      if (!st) return
      st.getVideoTracks().forEach((t) => {
        t.addEventListener("mute", update)
        t.addEventListener("unmute", update)
        t.addEventListener("ended", update)
        cleanups.push(() => {
          t.removeEventListener("mute", update)
          t.removeEventListener("unmute", update)
          t.removeEventListener("ended", update)
        })
      })
      st.addEventListener("addtrack", update)
      st.addEventListener("removetrack", update)
      cleanups.push(() => {
        st.removeEventListener("addtrack", update)
        st.removeEventListener("removetrack", update)
      })
    })
    const timer = setInterval(update, 500)
    return () => {
      clearInterval(timer)
      cleanups.forEach((c) => c())
    }
  }, [remoteStreams])

  return status
}

export function CallOverlay(props: CallOverlayProps) {
  const {
    call,
    dur,
    muted,
    videoOff,
    localStream,
    remoteStreams = {},
    remoteMediaState = {},
    roster,
    netHint = "good",
    totalCount,
    minimized = false,
    onToggleMinimize,
    onHangUp,
    onAccept,
    onRetry,
    onToggleMute,
    onToggleVideo,
    onSelectMicrophone,
  } = props

  const reduceMotion = usePrefersReducedMotion()
  const isVideo = call.kind === "video"
  const remoteList = Object.entries(remoteStreams)
  const connected = call.state === "in-call"
  const incoming = isIncomingRing(call)
  const ringing = isRinging(call.state)
  const reconnecting = isReconnecting(call.state, netHint)
  const remoteVideoStatus = useRemoteVideoStatus(remoteStreams)
  const isPeerVideoActive = (uid: number | string) => {
    const isOff = remoteMediaState?.[Number(uid)]?.videoOff ?? false
    return !isOff && !!remoteVideoStatus[Number(uid)]
  }
  const hasActiveRemoteVideo =
    isVideo && Object.keys(remoteStreams).some((uid) => isPeerVideoActive(uid))
  const hasVideo = isVideo && (hasActiveRemoteVideo || remoteList.length > 0)

  const directory = usePersonDirectory()

  const people = useMemo<CallPerson[]>(() => {
    if (roster && roster.length) return roster
    return (call.participants ?? []).map((p) => {
      const entry = directory[p.userId]
      const name = (entry?.name || p.name || "").trim() || "Người dùng"
      return {
        userId: p.userId,
        name,
        initials: initialsOf(name),
        avatar: entry?.avatar || undefined,
        color: colorForName(name),
      }
    })
  }, [roster, call.participants, directory])

  const others = people.filter((p) => !p.isSelf)
  const mainPerson = others[0]
  const mainProfile = useUserProfile(mainPerson?.userId, {
    fallbackName: mainPerson?.name || call.name,
    roomId: call.roomId ?? (call.convId < 1000000000 ? call.convId : undefined),
  })
  const mainDirAvatar = usePersonAvatar({ id: mainPerson?.userId }).avatar
  /** ẢNH CHÍNH: tra theo userId NGAY LÚC HIỂN THỊ trong thư viện người dùng
   * (cùng nguồn với danh sách hội thoại/bạn); thiếu mới rơi về dữ liệu có sẵn. */
  const isGroup =
    (totalCount !== undefined ? totalCount > 2 : false) ||
    others.length > 1 ||
    Boolean(call.isGroup)
  const layout = isGroup ? "grid" : "single"
  const groupAvatar = isGroup ? (call.avatar || "") : ""
  /** ẢNH CHÍNH: Trong cuộc gọi nhóm, dùng ảnh đại diện của nhóm (nếu có);
   * nếu không có thì fallback hoặc hiển thị chữ viết tắt của nhóm. */
  const mainAvatar =
    isGroup
      ? (groupAvatar || "")
      : (mainProfile.avatarUrl || mainDirAvatar || mainPerson?.avatar || call.avatar || "")
  /** Nguồn nền mờ, đã chuẩn hoá về cùng origin để ảnh luôn tải được. */
  const mainAvatarSrc = resolveAvatarUrl(mainAvatar)
  /** Tên đối phương (dùng cho thanh thu nhỏ + giai đoạn gọi/đổ chuông + tiêu đề). */
  const peerName = isGroup ? call.name : (mainProfile.displayName || mainPerson?.name || call.name)
  const count =
    totalCount ?? (people.length || (call.participants?.length ?? 0) + 1)

  const levels = useSpeakerLevels(
    remoteStreams,
    localStream,
    muted,
    connected,
    reduceMotion,
  )
  const activeId = useMemo(() => pickActiveSpeaker(levels), [levels])
  const mainLevel = mainPerson ? levels[mainPerson.userId] ?? 0 : 0

  const statusWord = callStatusWord({
    state: call.state,
    dir: call.dir,
    dur,
    reason: call.reason,
    finalDur: call.finalDur,
    reconnecting,
    acked: call.acked,
  })
  const clock = callClockText({
    state: call.state,
    dir: call.dir,
    dur,
    reason: call.reason,
    finalDur: call.finalDur,
  })

  /* ---- Thiết bị (loa/mic) ---- */
  const [devOpen, setDevOpen] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [outputId, setOutputId] = useState("")
  useEffect(() => {
    if (!devOpen) return
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined
    if (!md?.enumerateDevices) return
    md.enumerateDevices()
      .then((list) => setDevices(list))
      .catch(() => setDevices([]))
  }, [devOpen])

  /* ---- Phím tắt M tắt/bật micro ---- */
  useEffect(() => {
    if (minimized) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (connected) {
          e.preventDefault()
          onToggleMute()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [minimized, connected, onToggleMute])

  /* ---- Cuộc gọi đến: tự đóng sau 30 giây ---- */
  useEffect(() => {
    if (!incoming) return
    const t = window.setTimeout(() => onHangUp(), INCOMING_AUTO_CLOSE_MS)
    return () => window.clearTimeout(t)
  }, [incoming, onHangUp])

  /* ---- Thu nhỏ ---- */
  const defaultMiniPos = () => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024
    return {
      x: Math.max(16, vw - 340),
      y: 72,
    }
  }

  const {
    position: miniPos,
    isDragging: miniDragging,
    elementRef: miniRef,
    handlePointerDown: miniPointerDown,
  } = useDraggable({
    storageKey: "workchat.call.miniPos",
    defaultPos: defaultMiniPos,
    snapPadding: 12,
    threshold: 4,
  })

  const [miniBubble, setMiniBubble] = useState<boolean>(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem("workchat.call.miniBubble") === "1"
      }
    } catch {
      /* ignore */
    }
    return false
  })

  const toggleMiniBubble = (next: boolean) => {
    setMiniBubble(next)
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("workchat.call.miniBubble", next ? "1" : "0")
      }
    } catch {
      /* ignore */
    }
  }

  /* ---- Khung hình của mình (self tile): kéo thả & thu gọn ---- */
  const defaultSelfPos = () => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024
    const vh = typeof window !== "undefined" ? window.innerHeight : 768
    return {
      x: Math.max(16, vw - 148),
      y: Math.max(16, vh - 220),
    }
  }

  const {
    position: selfPos,
    isDragging: selfDragging,
    elementRef: selfRef,
    handlePointerDown: selfPointerDown,
  } = useDraggable({
    storageKey: "workchat.call.selfTile",
    defaultPos: defaultSelfPos,
    snapPadding: 12,
    threshold: 4,
  })

  const [selfCollapsed, setSelfCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage.getItem("workchat.call.selfCollapsed") === "1"
      }
    } catch {
      /* ignore */
    }
    return false
  })

  const toggleSelfCollapsed = (next: boolean) => {
    setSelfCollapsed(next)
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem("workchat.call.selfCollapsed", next ? "1" : "0")
      }
    } catch {
      /* ignore */
    }
  }

  if (minimized) {
    if (miniBubble) {
      return (
        <div
          ref={miniRef}
          onPointerDown={miniPointerDown}
          onDragStart={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            left: `${miniPos.x}px`,
            top: `${miniPos.y}px`,
            zIndex: 121,
            touchAction: "none",
            transition: miniDragging || reduceMotion ? "none" : "transform 0.15s ease-out",
          }}
          className="select-none cursor-grab active:cursor-grabbing"
        >
          <button
            type="button"
            data-no-drag="true"
            onClick={() => {
              toggleMiniBubble(false)
            }}
            className="relative group p-1 rounded-full bg-zinc-900/95 text-white border border-white/20 shadow-2xl backdrop-blur-md flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Mở rộng cuộc gọi"
            title={`${peerName} — Nhấn để mở rộng thanh cuộc gọi`}
          >
            {mainPerson || mainAvatar || isGroup ? (
              <CallAvatar
                userId={isGroup ? undefined : mainPerson?.userId}
                person={
                  isGroup
                    ? {
                        userId: 0,
                        name: call.name,
                        initials: initialsOf(call.name),
                        avatar: mainAvatar,
                        color: "#64748b",
                      }
                    : (mainPerson ?? {
                        userId: 0,
                        name: peerName,
                        initials: initialsOf(peerName),
                        avatar: mainAvatar,
                        color: "#64748b",
                      })
                }
                sizePx={46}
                fontSize={16}
                className={ringing && !reduceMotion ? "call-mini-pulse" : ""}
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-sm">
                {initialsOf(peerName)}
              </div>
            )}
            <span className="absolute bottom-0.5 right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-zinc-900" />
          </button>
        </div>
      )
    }

    return (
      <div
        ref={miniRef}
        onPointerDown={miniPointerDown}
        onDragStart={(e) => e.preventDefault()}
        className="fixed z-[121] rounded-2xl bg-zinc-900/95 text-white border border-white/15 shadow-2xl px-3 py-2.5 flex items-center gap-3 backdrop-blur-md select-none cursor-grab active:cursor-grabbing"
        style={{
          left: `${miniPos.x}px`,
          top: `${miniPos.y}px`,
          color: "#fff",
          maxWidth: "min(92vw, 360px)",
          touchAction: "none",
          transition: miniDragging || reduceMotion ? "none" : "box-shadow 0.15s",
        }}
        role="dialog"
        aria-label={`Cuộc gọi đang thu nhỏ với ${peerName}`}
      >
        <button
          type="button"
          data-no-drag="true"
          onClick={() => toggleMiniBubble(true)}
          aria-label="Thu nhỏ cuộc gọi thành bong bóng"
          title="Thu gọn thành bong bóng"
          className="w-7 h-7 rounded-lg hover:bg-white/10 active:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
          </svg>
        </button>

        <button
          type="button"
          data-no-drag="true"
          onClick={() => {
            if (onToggleMinimize) onToggleMinimize()
          }}
          className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label="Mở rộng cuộc gọi"
          title="Mở rộng cuộc gọi"
        >
          {mainPerson || mainAvatar || isGroup ? (
            <CallAvatar
              userId={isGroup ? undefined : mainPerson?.userId}
              person={
                isGroup
                  ? {
                      userId: 0,
                      name: call.name,
                      initials: initialsOf(call.name),
                      avatar: mainAvatar,
                      color: "#64748b",
                    }
                  : (mainPerson ?? {
                      userId: 0,
                      name: peerName,
                      initials: initialsOf(peerName),
                      avatar: mainAvatar,
                      color: "#64748b",
                    })
              }
              sizePx={40}
              fontSize={14}
              className={ringing && !reduceMotion ? "call-mini-pulse" : ""}
            />
          ) : null}
          <span className="min-w-0 flex-1 flex flex-col">
            <span className="block text-sm font-semibold truncate" title={peerName}>
              {peerName}
            </span>
            <span
              className="block text-xs tabular-nums truncate text-zinc-300"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              {clock || statusWord}
            </span>
          </span>
          <ExpandIcon />
        </button>
        <span data-no-drag="true">
          <ItemButton onClick={onToggleMute} label={micAriaLabel(muted)} variant={muted ? "mic-off" : "glass"} pressed={muted}>
            <MicIcon off={muted} />
          </ItemButton>
        </span>
        <span data-no-drag="true">
          <ItemButton onClick={onHangUp} label={endButtonLabel(call)} variant="danger">
            <PhoneDownIcon />
          </ItemButton>
        </span>
      </div>
    )
  }

  const cols = groupGridColumns(people.length)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cuộc gọi ${isVideo ? "video" : "thoại"} với ${call.name}`}
      className="fixed inset-0 z-[120] flex flex-col overflow-hidden select-none"
      style={{ color: "var(--call-fg)", backgroundColor: "var(--call-veil-strong)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Nền: ảnh đại diện làm mờ mạnh + gradient tối */}
      {mainAvatarSrc && (
        <img
          src={mainAvatarSrc}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{
            filter: "blur(52px) saturate(140%)",
            transform: "scale(1.25)",
            opacity: 0.5,
          }}
        />
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundColor: "var(--call-veil)",
          backgroundImage:
            "linear-gradient(180deg, rgba(0,0,0,0.28), transparent 28%, transparent 62%, rgba(0,0,0,0.6))",
        }}
      />

      {/* Âm thanh người nhận (luôn phát âm thanh cho mọi nguồn từ xa) */}
      {remoteList.map(([uid, st]) => (
        <CallStreamAudio key={uid} stream={st} sinkId={outputId || undefined} />
      ))}

      {/* Sân khấu video */}
      {hasVideo && (
        <>
          <div
            className="absolute inset-0 grid"
            style={{
              zIndex: 0,
              gridTemplateColumns: `repeat(${groupGridColumns(remoteList.length)}, 1fr)`,
              gap: 4,
              padding: 4,
            }}
          >
            {remoteList.map(([uid, st]) => {
              const p = people.find((x) => x.userId === Number(uid))
              const isVideoActive = isPeerVideoActive(uid)
              // Trong cuộc gọi 1-1: nếu đối phương tắt cam, sân khấu trung tâm (Khối giữa)
              // sẽ hiển thị Avatar lớn của họ một cách trang trọng, không render khung video đen.
              if (layout === "single" && !isVideoActive) {
                return null
              }
              return (
                <div
                  key={uid}
                  className="relative overflow-hidden rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: "rgba(15, 15, 20, 0.85)", minHeight: 120 }}
                >
                  {isVideoActive ? (
                    <CallStreamVideo
                      stream={st}
                      muted
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    /* Khi đối phương tắt cam (trong gọi nhóm): hiển thị Avatar của họ ở trung tâm tile */
                    <div className="flex flex-col items-center justify-center p-4">
                      <CallAvatar
                        person={p ?? { userId: Number(uid), name: "Người dùng", color: "#64748b" }}
                        userId={Number(uid)}
                        fallbackName={p?.name ?? "Người dùng"}
                        fallbackAvatar={p?.avatar}
                        color={p?.color ?? "#64748b"}
                        sizePx={110}
                        fontSize={36}
                        glow={levels[Number(uid)] ?? 0}
                        level={levels[Number(uid)] ?? 0}
                        speaking={connected && activeId === Number(uid)}
                      />
                      <p className="mt-3 text-sm font-medium text-white/90">
                        {p?.name || "Người dùng"}
                      </p>
                      <span className="mt-1 text-[11px] text-white/50 px-2 py-0.5 rounded-full bg-white/10">
                        Đã tắt camera
                      </span>
                    </div>
                  )}
                  {p && isVideoActive && (
                    <span className="absolute bottom-2 left-2 text-xs px-2 py-0.5 rounded-full call-glass">
                      {p.name}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {localStream && !videoOff && (
            selfCollapsed ? (
              <div
                ref={selfRef}
                onPointerDown={selfPointerDown}
                onDragStart={(e) => e.preventDefault()}
                style={{
                  position: "fixed",
                  left: `${selfPos.x}px`,
                  top: `${selfPos.y}px`,
                  zIndex: 40,
                  touchAction: "none",
                  transition: selfDragging || reduceMotion ? "none" : "all 0.15s ease-out",
                }}
                className="select-none cursor-grab active:cursor-grabbing"
              >
                <button
                  type="button"
                  data-no-drag="true"
                  onClick={() => {
                    toggleSelfCollapsed(false)
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-zinc-900/90 text-white border border-white/25 shadow-xl backdrop-blur-md hover:bg-zinc-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Hiện khung hình của bạn"
                  title="Hiện khung hình của bạn"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                  <span className="text-xs font-semibold">Bạn</span>
                </button>
              </div>
            ) : (
              <div
                ref={selfRef}
                onPointerDown={selfPointerDown}
                onDragStart={(e) => e.preventDefault()}
                className="fixed w-32 h-44 rounded-lg overflow-hidden shadow-2xl z-40 select-none cursor-grab active:cursor-grabbing group"
                style={{
                  left: `${selfPos.x}px`,
                  top: `${selfPos.y}px`,
                  border: "1px solid rgba(238,242,255,0.25)",
                  backgroundColor: "rgba(0,0,0,0.55)",
                  touchAction: "none",
                  transition: selfDragging || reduceMotion ? "none" : "box-shadow 0.15s",
                }}
              >
                <CallStreamVideo
                  stream={localStream}
                  muted
                  className="w-full h-full object-cover pointer-events-none"
                  style={{ transform: "scaleX(-1)" }}
                />
                <span className="absolute bottom-1.5 left-2 text-[10px] px-1.5 py-0.5 rounded call-glass pointer-events-none">
                  Bạn
                </span>
                <button
                  type="button"
                  data-no-drag="true"
                  onClick={() => toggleSelfCollapsed(true)}
                  aria-label="Thu gọn khung hình của bạn"
                  title="Thu gọn khung hình của bạn"
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 hover:bg-black/80 text-white/90 hover:text-white flex items-center justify-center transition-opacity opacity-80 group-hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="4 14 10 14 10 20" />
                    <polyline points="20 10 14 10 14 4" />
                  </svg>
                </button>
              </div>
            )
          )}
        </>
      )}

      {/* Xem trước camera của bản thân khi đang đổ chuông / kết nối cuộc gọi video */}
      {isVideo && localStream && !videoOff && !hasVideo && (
        selfCollapsed ? (
          <div
            ref={selfRef}
            onPointerDown={selfPointerDown}
            onDragStart={(e) => e.preventDefault()}
            style={{
              position: "fixed",
              left: `${selfPos.x}px`,
              top: `${selfPos.y}px`,
              zIndex: 40,
              touchAction: "none",
              transition: selfDragging || reduceMotion ? "none" : "all 0.15s ease-out",
            }}
            className="select-none cursor-grab active:cursor-grabbing"
          >
            <button
              type="button"
              data-no-drag="true"
              onClick={() => {
                toggleSelfCollapsed(false)
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-zinc-900/90 text-white border border-white/25 shadow-xl backdrop-blur-md hover:bg-zinc-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              aria-label="Hiện khung hình của bạn"
              title="Hiện khung hình của bạn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              <span className="text-xs font-semibold">Camera của bạn</span>
            </button>
          </div>
        ) : (
          <div
            ref={selfRef}
            onPointerDown={selfPointerDown}
            onDragStart={(e) => e.preventDefault()}
            className="fixed w-32 h-44 rounded-lg overflow-hidden shadow-2xl z-40 select-none cursor-grab active:cursor-grabbing group"
            style={{
              left: `${selfPos.x}px`,
              top: `${selfPos.y}px`,
              border: "1px solid rgba(238,242,255,0.25)",
              backgroundColor: "rgba(0,0,0,0.55)",
              touchAction: "none",
              transition: selfDragging || reduceMotion ? "none" : "box-shadow 0.15s",
            }}
          >
            <CallStreamVideo
              stream={localStream}
              muted
              className="w-full h-full object-cover pointer-events-none"
              style={{ transform: "scaleX(-1)" }}
            />
            <span className="absolute bottom-1.5 left-2 text-[10px] px-1.5 py-0.5 rounded call-glass pointer-events-none">
              Camera của bạn
            </span>
            <button
              type="button"
              data-no-drag="true"
              onClick={() => toggleSelfCollapsed(true)}
              aria-label="Thu gọn khung hình của bạn"
              title="Thu gọn khung hình của bạn"
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 hover:bg-black/80 text-white/90 hover:text-white flex items-center justify-center transition-opacity opacity-80 group-hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
              </svg>
            </button>
          </div>
        )
      )}

      {/* Thanh trên: chip E2E, chất lượng mạng, thu nhỏ */}
      <div className="relative z-20 flex items-center justify-between gap-3 px-4 md:px-6 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full call-glass text-[11px] font-medium"
            title="Nội dung được mã hoá đầu cuối"
          >
            <LockIcon />
            Mã hóa đầu cuối
          </span>
          {/* Thời lượng cuộc gọi chạy liên tục (hiển thị cho cả video và thoại) */}
          {connected && (
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full call-glass text-[12px] font-semibold tabular-nums text-white shadow-sm"
              title="Thời lượng cuộc gọi"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {clock || `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, "0")}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <NetBadge hint={netHint} />
          {onToggleMinimize && (
            <button
              type="button"
              onClick={onToggleMinimize}
              aria-label="Thu nhỏ cuộc gọi"
              title="Thu nhỏ"
              className="w-9 h-9 rounded-full call-glass flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <ChevronDownIcon />
            </button>
          )}
        </div>
      </div>

      {/* Dải trạng thái mạng */}
      {reconnecting ? (
        <div className="relative z-20 mx-4 md:mx-6 -mt-1 mb-1 rounded-xl bg-red-500/20 border border-red-500/30 text-red-200 px-3 py-1.5 text-center text-xs animate-pulse font-medium" role="status" aria-live="polite">
          ⚠️ Mất kết nối mạng · Đang kết nối lại…
        </div>
      ) : netHint === "weak" ? (
        <div className="relative z-20 mx-4 md:mx-6 -mt-1 mb-1 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-200 px-3 py-1.5 text-center text-xs font-medium" role="status" aria-live="polite">
          ⚠️ Mạng yếu · Đang tối ưu đường truyền
        </div>
      ) : null}

      {/* Khối giữa */}
      <div
        className="relative z-10 flex-1 min-h-0 w-full flex flex-col items-center justify-center px-4 md:px-6 text-center overflow-y-auto py-2"
        style={{ visibility: hasActiveRemoteVideo ? "hidden" : "visible" }}
      >
        {ringing || layout === "single" || !isGroup || others.length <= 1 || !mainPerson ? (
          <div className="relative flex items-center justify-center my-auto">
            {ringing && !reduceMotion && (
              <>
                <span aria-hidden className="absolute inset-0 rounded-full call-wave" style={{ border: "2px solid var(--call-ring)" }} />
                <span aria-hidden className="absolute inset-0 rounded-full call-wave call-wave-delay-1" style={{ border: "2px solid var(--call-ring)" }} />
                <span aria-hidden className="absolute inset-0 rounded-full call-wave call-wave-delay-2" style={{ border: "2px solid var(--call-ring)" }} />
              </>
            )}
            {mainPerson || mainAvatar || isGroup ? (
              <CallAvatar
                userId={isGroup ? undefined : mainPerson?.userId}
                person={
                  isGroup
                    ? {
                        userId: 0,
                        name: call.name,
                        initials: initialsOf(call.name),
                        avatar: mainAvatar,
                        color: "#64748b",
                      }
                    : (mainPerson ?? {
                        userId: 0,
                        name: peerName,
                        initials: initialsOf(peerName),
                        avatar: mainAvatar,
                        color: "#64748b",
                      })
                }
                sizePx={128}
                fontSize={44}
                glow={connected ? mainLevel : 0}
              />
            ) : (
              <div
                className="rounded-full call-glow"
                style={{ width: 128, height: 128, backgroundColor: "#64748b", border: "2px solid rgba(255,255,255,0.35)" }}
              />
            )}
          </div>
        ) : (
          <div
            className="grid gap-3 w-full max-w-xl mx-auto my-auto py-1"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {people.map((p) => (
              <PersonTile
                key={p.userId}
                person={p}
                level={levels[p.userId] ?? 0}
                speaking={connected && activeId === p.userId}
              />
            ))}
          </div>
        )}

        <div className="mt-3 flex-shrink-0">
          <h1 className="text-xl md:text-2xl font-semibold leading-tight" style={{ color: "var(--call-fg)" }}>
            {isGroup ? call.name : (count <= 2 ? peerName : call.name)}
          </h1>
          <p className="text-xs md:text-sm mt-1" style={{ color: "var(--call-sub)" }} role="status" aria-live="polite">
            {connected && isVideo && !hasActiveRemoteVideo ? "Đã tắt camera" : statusWord}
            {count > 2 ? ` · ${participantCountLabel(count)}` : ""}
          </p>
          {clock && (
            <p className="mt-1 text-2xl md:text-3xl font-light tabular-nums" style={{ color: "var(--call-fg)" }}>
              {clock}
            </p>
          )}
        </div>
      </div>

      {/* Điều khiển */}
      <div className="relative z-20 flex-shrink-0 pb-6 pt-2 px-6 flex flex-col items-center gap-3">
        {incoming ? (
          <div className="flex items-center gap-10">
            <button
              type="button"
              onClick={onAccept}
              aria-label="Trả lời"
              title="Trả lời"
              className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-xl transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              style={{ backgroundColor: "#22c55e" }}
            >
              <PhoneUpIcon />
            </button>
            <button
              type="button"
              onClick={onHangUp}
              aria-label="Từ chối"
              title="Từ chối"
              className="w-16 h-16 rounded-full flex items-center justify-center text-white shadow-xl transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              style={{ backgroundColor: "#ef4444" }}
            >
              <PhoneDownIcon big />
            </button>
          </div>
        ) : call.state === "failed" ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm" style={{ color: "var(--call-sub)" }}>
              Không gọi lại được tự động. Bạn có muốn thử lại?
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={onHangUp}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-transform hover:scale-105"
                style={{ backgroundColor: "#ef4444" }}
              >
                Kết thúc
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-transform hover:scale-105"
                style={{ backgroundColor: "var(--primary)", color: "var(--primary-fg)" }}
              >
                Thử lại
              </button>
            </div>
          </div>
        ) : call.state === "calling" || call.state === "connecting" ? (
          <div className="rounded-full call-glass px-4 py-3 flex items-center gap-3 md:gap-4">
            <ItemButton onClick={onToggleMute} label={micAriaLabel(muted)} variant={muted ? "mic-off" : "glass"} pressed={muted}>
              <MicIcon off={muted} />
            </ItemButton>
            <ItemButton
              onClick={onHangUp}
              label={endButtonLabel(call)}
              variant="danger"
            >
              <PhoneDownIcon />
            </ItemButton>
          </div>
        ) : (
          <div className="relative rounded-full call-glass px-3 md:px-4 py-2.5 flex items-center gap-2 md:gap-3">
            <ItemButton onClick={onToggleMute} label={micAriaLabel(muted)} variant={muted ? "mic-off" : "glass"} pressed={muted}>
              <MicIcon off={muted} />
            </ItemButton>

            <div className="relative">
              <ItemButton
                onClick={() => setDevOpen((v) => !v)}
                label="Chọn thiết bị loa/mic"
                pressed={devOpen}
              >
                <SpeakerIcon />
              </ItemButton>
              {devOpen && (
                <div
                  className="absolute bottom-16 left-1/2 -translate-x-1/2 w-64 rounded-2xl call-glass shadow-2xl p-3 text-left"
                  style={{ color: "var(--call-fg)", backgroundColor: "var(--call-veil-strong)" }}
                  role="menu"
                >
                  {devices.length === 0 ? (
                    <p className="text-xs px-1 py-2" style={{ color: "var(--call-sub)" }}>
                      Trình duyệt không cho xem thiết bị.
                    </p>
                  ) : (
                    <>
                      <p className="text-[10px] uppercase tracking-wide px-1 mb-1" style={{ color: "var(--call-sub)" }}>
                        Loa
                      </p>
                      {devices.filter((d) => d.kind === "audiooutput").map((d) => (
                        <button
                          key={d.deviceId}
                          type="button"
                          role="menuitemradio"
                          aria-checked={outputId === d.deviceId}
                          onClick={() => {
                            setOutputId(d.deviceId)
                            setDevOpen(false)
                          }}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-white/10 truncate"
                        >
                          {outputId === d.deviceId ? "✓ " : ""}
                          {d.label || "Loa mặc định"}
                        </button>
                      ))}
                      <p className="text-[10px] uppercase tracking-wide px-1 mt-2 mb-1" style={{ color: "var(--call-sub)" }}>
                        Micro
                      </p>
                      {devices.filter((d) => d.kind === "audioinput").map((d) => (
                        <button
                          key={d.deviceId}
                          type="button"
                          disabled={!onSelectMicrophone}
                          onClick={() => {
                            onSelectMicrophone?.(d.deviceId)
                            setDevOpen(false)
                          }}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-white/10 disabled:opacity-50 truncate"
                        >
                          {d.label || "Micro mặc định"}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            <ItemButton
              onClick={onToggleVideo}
              label={cameraToggleLabel(videoOff)}
              variant={isVideo && videoOff ? "camera-off" : "glass"}
              disabled={!isVideo}
              pressed={isVideo && videoOff}
            >
              <CameraIcon off={isVideo && videoOff} />
            </ItemButton>

            <ItemButton onClick={onHangUp} label={endButtonLabel(call)} variant="danger">
              <PhoneDownIcon big />
            </ItemButton>
          </div>
        )}
      </div>
    </div>
  )
}
