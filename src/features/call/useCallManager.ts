import { useState, useRef, useEffect, useMemo } from "react"
import {
  CallSession,
  type CallParticipantInfo,
  type CallPhase,
} from "../../lib/webrtc"
import type { PeerClient, PeerUiFrame, CallKind } from "../../lib/peer"
import {
  canStartCall,
  decideOnInvite,
  callErrorReason,
  callStateAction,
  type CallLocalPhase,
  type LocalCallView,
} from "../../lib/callGuard"
import { callDebug, summarizeCallPayload } from "../../lib/callDebug"
import { callPreviewText } from "../../lib/conversationPreview"
import { api } from "../../lib/api"
import {
  buildCallRoster,
  type CallPerson,
  type CallRosterEntry,
} from "../../lib/callView"
import {
  ensurePeople,
  getPerson,
  putPerson,
  nameOf,
} from "../../lib/personDirectory"
import {
  type Conversation,
  type Message,
  type MessageCallData,
  ROOM_ID_OFFSET,
  formatNowTime,
  genClientId,
} from "../../types/chat"

/**
 * Thời gian chờ ack end-to-end tối đa (ms) sau khi bấm gọi. Không nhận được `call_state
 * "acked"` trong khoảng này → kết thúc với outcome `"unreachable"` (thay vì treo 45 giây).
 * 6 giây đủ cho bắt tay PeerLink + định tuyến nội bộ máy nhận.
 */
export const CALL_ACK_TIMEOUT_MS = 6000

export interface ActiveCallState {
  kind: "voice" | "video"
  dir: "out" | "in"
  state: "calling" | "connecting" | "in-call" | "ended" | "failed"
  name: string
  avatar?: string
  isGroup?: boolean
  reason?: string
  startAt?: number
  finalDur?: number
  acc?: number
  convId: number
  roomId?: number
  callId?: string
  callerId?: number
  /** Cuộc gọi đi: userId của người đang được gọi (dùng cho quy tắc glare). */
  peerId?: number
  /** Danh sách userId tất cả người đang được gọi (nhóm / 1-1). */
  peerIds?: number[]
  /** epoch ms lúc bắt đầu đổ chuông (bấm gọi / nhận lời mời). */
  dialedAt?: number
  /** Bên gọi: đã nhận ack end-to-end (Core bên nhận đã đẩy lời mời xuống UI) chưa. */
  acked?: boolean
  participants?: CallParticipantInfo[]
}

export interface UseCallManagerOptions {
  meId: number
  meIdRef?: React.MutableRefObject<number>
  meUsername?: string | null
  profile: { name: string; avatar?: string }
  conversations: Conversation[]
  conversationsRef?: React.MutableRefObject<Conversation[]>
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  friendList?: Array<{
    id: number
    name: string
    username?: string
    avatar?: string
    publicId?: string
  }>
  selectedId?: number | undefined
  selected?: Conversation
  peerState?: string
  peerRef: React.MutableRefObject<PeerClient | null>
  pushToast: (msg: string) => void
  refreshRooms?: () => Promise<void>
  selectedRoomIdRef?: React.MutableRefObject<number | undefined>
  onCallFrameRef?: React.MutableRefObject<(f: PeerUiFrame) => void>
  onCallErrorRef?: React.MutableRefObject<(code: string | undefined, detail?: string) => void>
}

export function useCallManager({
  meId,
  meIdRef,
  meUsername,
  profile,
  conversations,
  conversationsRef,
  setConversations,
  friendList = [],
  selectedId,
  selected,
  peerState = "on",
  peerRef,
  pushToast,
  refreshRooms = async () => {},
  selectedRoomIdRef,
  onCallFrameRef,
  onCallErrorRef,
}: UseCallManagerOptions) {
  const [call, setCall] = useState<ActiveCallState | null>(null)
  const [callMuted, setCallMuted] = useState(false)
  const [callVideoOff, setCallVideoOff] = useState(false)
  const [callMinimized, setCallMinimized] = useState(false)
  const [callNetQuality, setCallNetQuality] = useState<"good" | "weak" | "down">("good")

  // Lắng nghe trạng thái mạng của trình duyệt trong cuộc gọi
  useEffect(() => {
    const handleOnline = () => {
      setCallNetQuality("good")
      if (callStateRef.current && callStateRef.current.state === "in-call") {
        pushToast("Đã kết nối lại mạng internet")
      }
    }
    const handleOffline = () => {
      setCallNetQuality("down")
      if (callStateRef.current && callStateRef.current.state === "in-call") {
        pushToast("Mất kết nối mạng internet")
      }
    }
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [pushToast])

  // Cảnh báo người dùng khi tải lại hoặc rời trang lúc đang có cuộc gọi
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const c = callStateRef.current
      if (c && c.state !== "ended" && c.state !== "failed") {
        e.preventDefault()
        e.returnValue = "Cuộc gọi đang diễn ra. Bạn có chắc chắn muốn tải lại hoặc rời đi? Cuộc gọi sẽ kết thúc."
        return e.returnValue
      }
    }
    const handlePageHide = () => {
      const c = callStateRef.current
      if (c && c.state !== "ended" && c.state !== "failed") {
        try {
          callSessionRef.current?.hangup("disconnect")
        } catch {}
        finalizeCall(c.dir === "out" ? "cancelled" : "completed")
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    window.addEventListener("pagehide", handlePageHide)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("pagehide", handlePageHide)
    }
  }, [])
  const [callRemoteMediaState, setCallRemoteMediaState] = useState<
    Record<number, { videoOff?: boolean; audioOff?: boolean }>
  >({})
  const [, setCallTick] = useState(0)
  const [callLocalStream, setCallLocalStream] = useState<MediaStream | null>(null)
  const [callRemoteStreams, setCallRemoteStreams] = useState<
    Record<number, MediaStream>
  >({})

  const callRef = useRef<{
    timers: number[]
    hadCall: boolean
    tick: number | null
  }>({
    timers: [],
    hadCall: false,
    tick: null,
  })
  const callSessionRef = useRef<CallSession | null>(null)
  const callStateRef = useRef<ActiveCallState | null>(null)
  const fallbackConversationsRef = useRef(conversations)
  useEffect(() => {
    fallbackConversationsRef.current = conversations
  }, [conversations])
  const activeConversationsRef = conversationsRef ?? fallbackConversationsRef

  useEffect(() => {
    callStateRef.current = call
  }, [call])

  const clearCallTimers = () => {
    callRef.current.timers.forEach((t) => window.clearTimeout(t))
    callRef.current.timers = []
  }

  const waitCall = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    callRef.current.timers.push(id)
  }

  const callLabel = (
    kind: "voice" | "video",
    dir: "out" | "in",
    duration: number,
    outcome:
      | "completed"
      | "missed"
      | "rejected"
      | "cancelled"
      | "no-answer"
      | "unreachable"
      | "busy",
  ) => callPreviewText({ type: kind, dir, duration, outcome })

  const closeCallSession = () => {
    const s = callSessionRef.current
    if (s) {
      try {
        s.close()
      } catch {}
      callSessionRef.current = null
    }
    callStateRef.current = null
    setCallLocalStream(null)
    setCallRemoteStreams({})
    setCallRemoteMediaState({})
  }

  const onRemoteStreamUpdate = (userId: number, stream: MediaStream | null) => {
    setCallRemoteStreams((prev) => {
      if (stream) {
        if (prev[userId] === stream) return prev
        return { ...prev, [userId]: stream }
      }
      if (!(userId in prev)) return prev
      const next = { ...prev }
      delete next[userId]
      return next
    })
  }

  const handleCallPhase = (callId: string, phase: CallPhase) => {
    if (callStateRef.current?.callId === callId) {
      if (phase === "active") {
        callStateRef.current = {
          ...callStateRef.current,
          state: "in-call",
          acked: true,
          startAt: callStateRef.current.startAt ?? Date.now(),
        }
      } else if (phase === "connecting") {
        callStateRef.current = {
          ...callStateRef.current,
          state: "connecting",
          acked: true,
        }
      }
    }
    if (phase === "active") {
      setCall((c) =>
        c && c.callId === callId && c.state !== "in-call"
          ? { ...c, state: "in-call", acked: true, startAt: c.startAt ?? Date.now() }
          : c,
      )
    } else if (phase === "connecting") {
      setCall((c) =>
        c && c.callId === callId && c.state === "calling"
          ? { ...c, state: "connecting", acked: true }
          : c,
      )
    }
  }

  const finalizeCall = (
    outcome:
      | "completed"
      | "missed"
      | "rejected"
      | "cancelled"
      | "no-answer"
      | "unreachable"
      | "busy",
  ) => {
    clearCallTimers()
    setCallNetQuality("good")
    const s = callSessionRef.current
    if (s) {
      try {
        s.close()
      } catch {}
    }
    callSessionRef.current = null
    const c = callStateRef.current
    if (!c) return
    const endedAt = Date.now()
    const duration = c.startAt
      ? Math.floor((endedAt - c.startAt) / 1000)
      : (c.acc ?? 0)
    const startedAt = c.dialedAt ?? c.startAt ?? endedAt
    const time = formatNowTime()
    const id = Date.now()
    const rawCallId = c.callId ? c.callId.replace(/[^0-9A-Za-z_-]/g, "_") : ""
    const clientId = rawCallId ? `call_${rawCallId}`.slice(0, 60) : genClientId()
    // Tìm cuộc trò chuyện tương ứng (khớp cả id, realId lẫn ROOM_ID_OFFSET)
    const matchesTarget = (cv: Conversation) => {
      if (cv.id === c.convId) return true
      if (c.roomId !== undefined) {
        if (cv.realId === c.roomId) return true
        if (cv.id === c.roomId) return true
        if (cv.id >= ROOM_ID_OFFSET && cv.id - ROOM_ID_OFFSET === c.roomId) return true
      }
      return false
    }
    const conv =
      activeConversationsRef.current.find(matchesTarget) ||
      conversations.find(matchesTarget)
    const realId = conv?.realId ?? c.roomId
    const members = conv?.members ?? []
    const participants = members.length || (c.participants?.length ?? 0) + 1
    const groupIds = conv?.isGroup
      ? members.filter((m) => m.id !== meId).map((m) => m.id)
      : undefined
    const callData: MessageCallData = {
      type: c.kind,
      dir: c.dir,
      duration,
      outcome,
      startedAt,
      endedAt,
      starterId: c.callerId ?? (c.dir === "out" ? meId : undefined),
      participants: participants > 2 ? participants : undefined,
      callId: c.callId,
      groupIds: groupIds && groupIds.length ? groupIds : undefined,
    }
    const callPayload = JSON.stringify({
      kind: "call",
      call: callData,
    })
    const newMsg: Message = {
      id,
      clientId,
      text: callPayload,
      fromMe: c.dir === "out",
      time,
      kind: "call",
      call: callData,
      sentAt: endedAt,
      decrypted: true,
    }
    // Cuộc gọi nhỡ ở phía người nhận: đánh dấu chưa đọc nếu đang không mở phòng.
    const missedIncoming =
      c.dir === "in" && (outcome === "missed" || outcome === "no-answer")
    const roomOpen = selectedRoomIdRef?.current === realId
    setConversations((prev) => {
      const exists = prev.some(matchesTarget)
      if (!exists && realId) {
        return [
          {
            id: ROOM_ID_OFFSET + realId,
            realId,
            name: c.name || "Cuộc gọi",
            initials: "#",
            online: true,
            time,
            lastMessage: callLabel(c.kind, c.dir, duration, outcome),
            lastAt: endedAt,
            messages: [newMsg],
            isGroup: false,
            unread: missedIncoming && !roomOpen ? 1 : 0,
          },
          ...prev,
        ]
      }
      return prev.map((cv) =>
        matchesTarget(cv)
          ? {
              ...cv,
              messages: [
                ...cv.messages.filter((m) => m.clientId !== clientId),
                newMsg,
              ],
              lastMessage: callLabel(c.kind, c.dir, duration, outcome),
              time,
              lastAt: endedAt,
              unread:
                missedIncoming && !roomOpen ? (cv.unread ?? 0) + 1 : cv.unread,
            }
          : cv,
      )
    })
    // Lưu sự kiện cuộc gọi: bên bắt đầu cuộc gọi (starter / c.dir === "out")
    // là nguồn duy nhất ghi nhận vào Tracker và Peer Core để tránh tạo trùng bản ghi.
    if (realId !== undefined && c.dir === "out") {
      api
        .sendMessage(realId, {
          client_msg_id: clientId,
          text: "",
          type: c.kind === "video" ? "video" : "voice",
        })
        .catch(() => {})
      if (peerState === "on" && peerRef.current) {
        peerRef.current.send({
          type: "send",
          roomId: realId,
          text: callPayload,
          clientId,
        })
      }
    }
    setCallLocalStream(null)
    setCallRemoteStreams({})
    setCallMinimized(false)
    callStateRef.current = null
    setCall({
      ...c,
      state: "ended",
      reason:
        outcome === "completed"
          ? "Cuộc gọi đã kết thúc"
          : outcome === "busy"
            ? "Đối phương đang bận"
            : outcome === "unreachable"
              ? c.dir === "in"
                ? "Cuộc gọi nhỡ"
                : "Không kết nối được"
              : outcome === "missed" || outcome === "no-answer"
                ? "Cuộc gọi nhỡ"
                : outcome === "rejected"
                  ? "Cuộc gọi bị từ chối"
                  : "Đã huỷ cuộc gọi",
      startAt: undefined,
      finalDur: duration,
    })
    waitCall(() => {
      setCall((cur) => {
        if (cur && cur.callId !== c.callId) return cur
        return null
      })
      if (callStateRef.current?.callId === c.callId) {
        callStateRef.current = null
      }
    }, 1600)
  }

  const endCallFromSession = (reason?: string) => {
    const c = callStateRef.current
    if (!c) {
      closeCallSession()
      return
    }
    let outcome: "completed" | "missed" | "rejected" | "cancelled" | "busy" =
      "completed"
    if (reason && (reason.includes("Không có ai trả lời") || reason.includes("timeout"))) {
      pushToast("Không có ai trả lời. Cuộc gọi đã kết thúc.")
      outcome = "no-answer"
    } else if (c.state === "calling" || c.state === "connecting") {
      if (c.dir === "out") {
        if (
          reason &&
          (reason.toLowerCase().includes("busy") || reason.includes("bận"))
        ) {
          outcome = "busy"
        } else {
          // Bên gọi nhận tín hiệu: "từ chối" (bị từ chối) hay huỷ/kết thúc.
          outcome =
            reason && reason.includes("từ chối") ? "rejected" : "cancelled"
        }
      } else {
        // Bên nhận: bên gọi đã huỷ/hết chuông → nhỡ.
        outcome = "missed"
      }
    }
    finalizeCall(outcome)
  }

  const buildCallSession = (opts: {
    kind: CallKind
    roomId: number
    callId: string
    isCaller: boolean
    callerId: number
    callerName: string
    expectedPeerIds?: number[]
  }) =>
    new CallSession({
      callId: opts.callId,
      roomId: opts.roomId,
      kind: opts.kind,
      myId: meIdRef?.current ?? meId,
      myName: profile.name || meUsername || "Tôi",
      isCaller: opts.isCaller,
      callerId: opts.callerId,
      callerName: opts.callerName,
      expectedPeerIds: opts.expectedPeerIds,
      send: (payload) => {
        callDebug("gui-tin-hieu", summarizeCallPayload(payload))
        return peerRef.current?.sendCall(payload) ?? false
      },
      onParticipants: (list) =>
        setCall((c) =>
          c && c.callId === opts.callId ? { ...c, participants: list } : c,
        ),
      onRemoteStream: onRemoteStreamUpdate,
      onRemoteMediaState: (userId, state) => {
        setCallRemoteMediaState((prev) => ({
          ...prev,
          [userId]: { ...prev[userId], ...state },
        }))
      },
      onEnded: (reason) => endCallFromSession(reason),
      onError: (msg) => pushToast(msg),
      onPhase: (phase) => handleCallPhase(opts.callId, phase),
      onNetworkState: (st, detail) => {
        setCallNetQuality(st === "disconnected" ? "down" : st)
        if (detail) {
          callDebug("call-network-quality", { state: st, detail })
        }
      },
    })

  /**
   * Trạng thái cuộc gọi cục bộ đã quy về dạng thuần cho {@link canStartCall} /
   * {@link decideOnInvite}. Trả `null` khi máy đang rảnh (không có cuộc gọi, hoặc cuộc
   * gọi vừa kết thúc và đang chờ ẩn thẻ).
   */
  const localCallView = (): LocalCallView | null => {
    const c = callStateRef.current
    if (!c || !c.callId) return null
    if (c.state === "ended" || c.state === "failed") return null
    const phase: CallLocalPhase =
      c.state === "in-call"
        ? "in-call"
        : c.state === "connecting"
          ? "connecting"
          : "ringing"
    return {
      callId: c.callId,
      dir: c.dir,
      phase,
      roomId: c.roomId,
      peerIds:
        c.peerIds && c.peerIds.length > 0
          ? c.peerIds
          : c.peerId
            ? [c.peerId]
            : undefined,
    }
  }

  /** Máy đang bận cuộc gọi (đang chuông / đang kết nối / đang gọi) — dùng để khoá nút gọi. */
  const callBusy = !!call && call.state !== "ended" && call.state !== "failed"

  const startCall = async (kind: CallKind, convArg?: Conversation) => {
    if (callSessionRef.current) {
      if (
        callSessionRef.current.isFinished ||
        !callStateRef.current ||
        callStateRef.current.state === "ended"
      ) {
        try {
          callSessionRef.current.close()
        } catch {}
        callSessionRef.current = null
      }
    }
    // Quy tắc 1: mọi phòng đều không được bắt đầu cuộc gọi mới khi đang bận.
    const gate = canStartCall(localCallView())
    if (!gate.ok) {
      callDebug("chan-bam-goi", { lyDo: gate.reason, ...(localCallView() ?? {}) })
      pushToast(gate.reason ?? "Đang có cuộc gọi khác")
      return
    }
    const conv =
      convArg ??
      activeConversationsRef.current.find((c) => c.id === selectedId) ??
      selected
    if (!conv) {
      pushToast("Không tìm thấy hội thoại để gọi")
      return
    }
    const roomId =
      conv.realId ??
      (conv.id >= ROOM_ID_OFFSET ? conv.id - ROOM_ID_OFFSET : conv.id)
    if (!roomId) {
      pushToast("Phòng chưa sẵn sàng để gọi")
      return
    }
    let peerIds = (conv.members ?? [])
      .map((m) => m.id)
      .filter((id) => id !== meId)
    if (
      peerIds.length === 0 &&
      conv.id < ROOM_ID_OFFSET &&
      conv.id > 0 &&
      conv.id !== meId
    ) {
      peerIds = [conv.id]
    }
    if (peerIds.length === 0) {
      pushToast("Không có ai trong phòng để gọi")
      return
    }
    // Cuộc gọi mới: huỷ mọi timer của cuộc gọi trước (đặc biệt timer ẩn thẻ 1.6s) để
    // không xoá nhầm trạng thái cuộc gọi vừa tạo khi người dùng gọi lại nhanh.
    clearCallTimers()
    const callId = `c${meId}-${Date.now()}`
    const session = buildCallSession({
      kind,
      roomId,
      callId,
      isCaller: true,
      callerId: meId,
      callerName: profile.name || meUsername || "Tôi",
      expectedPeerIds: peerIds,
    })
    callSessionRef.current = session
    setCallMuted(false)
    setCallVideoOff(false)
    setCallRemoteStreams({})
    setCallLocalStream(null)
    const nextCall: ActiveCallState = {
      kind,
      dir: "out",
      state: "calling",
      name: conv.name,
      avatar: conv.avatar,
      isGroup: !!conv.isGroup,
      convId: conv.id,
      roomId,
      callId,
      callerId: meId,
      peerId: peerIds[0],
      peerIds,
      dialedAt: Date.now(),
      acked: false,
      participants: [],
    }
    callStateRef.current = nextCall
    setCall(nextCall)
    setCallMinimized(false)
    await session.start()
    setCallLocalStream(session.localStream)
    // BƯỚC 4: KHÔNG đổ chuông "thật" cho tới khi Core bên nhận xác nhận (ack end-to-end).
    // Chờ ack tối đa CALL_ACK_TIMEOUT_MS; hết hạn mà chưa có → "Không kết nối được".
    waitCall(() => {
      const cur = callStateRef.current
      if (
        cur &&
        cur.callId === callId &&
        cur.state === "calling" &&
        !cur.acked &&
        !cur.isGroup
      ) {
        callDebug("het-han-ack", { callId, ms: CALL_ACK_TIMEOUT_MS })
        session.hangup()
        callSessionRef.current = null
        finalizeCall("unreachable")
      }
    }, CALL_ACK_TIMEOUT_MS)
  }

  /**
   * Bắt đầu đồng hồ 45 giây "không có người trả lời" — CHỈ sau khi đã nhận ack end-to-end
   * (lời mời đã thực sự tới UI người nhận). Trước ack, việc chờ do timer ack quản lý.
   */
  const startNoAnswerTimer = (callId: string) => {
    waitCall(() => {
      const cur = callStateRef.current
      if (cur && cur.callId === callId && cur.state === "calling" && cur.acked) {
        const s = callSessionRef.current
        if (s) s.hangup()
        callSessionRef.current = null
        finalizeCall("no-answer")
      }
    }, 45000)
  }

  const handlePeerCall = (f: PeerUiFrame) => {
    if (!f.callId || f.roomId === undefined) return
    const currentMyId = meId
    if (f.fromUserId !== undefined && currentMyId > 0 && f.fromUserId === currentMyId) return
    if (f.signal === "invite") {
      // Quy tắc 2-4: một cuộc gọi tại một thời điểm + phân xử khi hai bên cùng gọi nhau.
      const local = localCallView()
      const decision = decideOnInvite(local, f, currentMyId)
      callDebug("quyet-dinh-loi-moi", {
        quyetDinh: decision,
        callId: f.callId,
        roomId: f.roomId,
        fromUserId: f.fromUserId,
        localCallId: local?.callId,
        localPhase: local?.phase,
        localDir: local?.dir,
      })
      if (decision === "dup" || decision === "glare-keep") return
      if (decision === "busy") {
        peerRef.current?.sendCall({
          signal: "reject",
          callId: f.callId,
          roomId: f.roomId,
          to: f.fromUserId,
          reason: "busy",
        })
        return
      }
      if (decision === "glare-yield") {
        // Ta thua trong cuộc gọi chéo: HUỶ cuộc gọi đi của mình (gửi `cancel` để bên kia
        // không phải chờ hết 45 giây) rồi hiện chuông cho cuộc gọi đến.
        const s = callSessionRef.current
        if (s) {
          try {
            s.hangup()
          } catch {}
          callSessionRef.current = null
        }
        callStateRef.current = null
        clearCallTimers()
        setCall(null)
        setCallMinimized(false)
      }

      // Nếu có phiên cũ đã xong/rác, dọn dẹp để sẵn sàng đón cuộc gọi mới
      if (callSessionRef.current) {
        try {
          callSessionRef.current.close()
        } catch {}
        callSessionRef.current = null
      }
      callStateRef.current = null
      // Huỷ timer cũ (ẩn thẻ / hết chuông) trước khi tạo trạng thái cuộc gọi đến mới.
      clearCallTimers()

      const targetRoomId = Number(f.roomId)
      let conv = activeConversationsRef.current.find(
        (c) =>
          c.realId === targetRoomId ||
          c.id === targetRoomId ||
          (c.id >= ROOM_ID_OFFSET && c.id - ROOM_ID_OFFSET === targetRoomId),
      )
      if (!conv) {
        // Vừa reload trang: conversations chưa kịp nạp xong từ /api/rooms.
        // Tạo conversation tạm thời để không bỏ lỡ cuộc gọi đến.
        const fallbackName = f.callerName || f.fromUsername || "Cuộc gọi"
        conv = {
          id: f.roomId,
          realId: f.roomId,
          name: fallbackName,
          initials: "#",
          online: true,
          time: "",
          lastMessage: "",
          messages: [],
          isGroup: false,
        }
        void refreshRooms()
      }

      const kind: CallKind = f.kind === "video" ? "video" : "voice"
      // Trong phòng 1-1, người gọi chắc chắn là thành viên còn lại (khác meId)
      const otherMember = (conv.members ?? []).find((m) => m.id !== meId)
      const parsedCallerId = f.callId?.startsWith("c")
        ? Number.parseInt(f.callId.slice(1).split("-")[0], 10)
        : undefined
      const callerId =
        (f.fromUserId && f.fromUserId > 0 ? f.fromUserId : undefined) ||
        (parsedCallerId && parsedCallerId > 0 ? parsedCallerId : undefined) ||
        (otherMember?.id && otherMember.id > 0 ? otherMember.id : undefined) ||
        0
      const callerMember =
        conv.members?.find((m) => m.id === callerId) || otherMember
      const callerName =
        callerMember?.name || f.callerName || f.fromUsername || conv.name
      const callerAvatar = callerMember?.avatar || conv.avatar
      if (callerId > 0 && (callerAvatar || callerName)) {
        putPerson({
          id: callerId,
          name: callerName,
          username: f.fromUsername || callerMember?.username,
          avatar: callerAvatar,
        })
      }
      const session = buildCallSession({
        kind,
        roomId: f.roomId,
        callId: f.callId,
        isCaller: false,
        callerId,
        callerName,
      })
      callSessionRef.current = session
      setCallMuted(false)
      setCallVideoOff(false)
      setCallRemoteStreams({})
      setCallLocalStream(null)
      const nextCall: ActiveCallState = {
        kind,
        dir: "in",
        state: "calling",
        name: conv.name,
        avatar: conv.avatar,
        isGroup: !!conv.isGroup,
        convId: conv.id,
        roomId: f.roomId,
        callId: f.callId,
        callerId,
        peerId: callerId,
        dialedAt: Date.now(),
        participants: callerId
          ? [{ userId: callerId, name: callerName }]
          : otherMember
            ? [{ userId: otherMember.id, name: callerName }]
            : [],
      }
      callStateRef.current = nextCall
      setCall(nextCall)
      setCallMinimized(false)
      return
    }
    if (f.type === "call_state") {
      const c = callStateRef.current
      const action = callStateAction({
        frameCallId: f.callId,
        frameState: f.callState,
        currentCallId: c?.callId,
        currentDir: c?.dir,
        currentState: c?.state,
        currentAcked: c?.acked,
      })
      if (action === "ignore") return
      callDebug("call-state-nhan", { callId: f.callId, state: f.callState, via: f.via })
      if (action === "ack") {
        if (c && c.callId) {
          setCall((cur) =>
            cur && cur.callId === c.callId ? { ...cur, acked: true } : cur,
          )
          if (callStateRef.current?.callId === c.callId) {
            callStateRef.current = { ...c, acked: true }
          }
          startNoAnswerTimer(c.callId)
        }
        return
      }
      // action === "unreachable"
      const msg =
        f.callState === "ack_no_ui"
          ? `${c?.name || "Người nhận"} chưa mở ứng dụng/chưa kết nối`
          : `Không kết nối được tới ${c?.name || "người nhận"} — thử lại sau`
      if (c && f.callId) finishOutgoingUnreachable(f.callId, msg)
      return
    }
    if (f.signal === "reject" && f.reason === "busy") {
      const busyUserId = f.fromUserId
      let busyName = ""
      if (busyUserId && busyUserId > 0) {
        busyName = nameOf(busyUserId) || ""
        if (!busyName) {
          const targetRoomId = Number(f.roomId)
          const conv = activeConversationsRef.current.find(
            (cv) =>
              cv.realId === targetRoomId ||
              cv.id === targetRoomId ||
              (cv.id >= ROOM_ID_OFFSET &&
                cv.id - ROOM_ID_OFFSET === targetRoomId),
          )
          const m = (conv?.members ?? []).find((mem) => mem.id === busyUserId)
          if (m?.name) busyName = m.name
        }
      }
      if (!busyName && f.fromUsername) {
        busyName = f.fromUsername
      }
      if (!busyName && callStateRef.current?.name) {
        const conv = activeConversationsRef.current.find(
          (cv) => cv.id === callStateRef.current?.convId,
        )
        if (conv && !conv.isGroup) {
          busyName = conv.name
        }
      }
      const message = busyName
        ? `${busyName} đang bận không thể nghe máy`
        : "Đối phương đang bận không thể nghe máy"
      pushToast(message)
    }
    if (f.signal === "accept" || f.signal === "answer") {
      clearCallTimers()
      if (
        callStateRef.current &&
        (callStateRef.current.callId === f.callId ||
          (callStateRef.current.roomId !== undefined &&
            callStateRef.current.roomId === f.roomId))
      ) {
        callStateRef.current = {
          ...callStateRef.current,
          acked: true,
          state:
            callStateRef.current.state === "calling"
              ? "connecting"
              : callStateRef.current.state,
        }
        setCall((cur) =>
          cur &&
          (cur.callId === f.callId ||
            (cur.roomId !== undefined && cur.roomId === f.roomId))
            ? {
                ...cur,
                acked: true,
                state: cur.state === "calling" ? "connecting" : cur.state,
              }
            : cur,
        )
      }
    }
    callSessionRef.current?.handle(f)
  }

  /**
   * Lỗi do Peer Core bên GỌI trả về (frame `error`): `bad_call` (khung sai), `not_bound`
   * (Core chưa gắn tài khoản), `NO_PEERS_ONLINE` (không ai trong phòng trực tuyến). Khi ta
   * đang GỌI ĐI và chưa kết nối, dừng chuông NGAY với lý do tiếng Việt và **không** ghi sự
   * kiện cuộc gọi (đây là lỗi phía máy ta, không phải cuộc gọi thực sự diễn ra).
   */
  const handlePeerError = (code: string | undefined, detail?: string) => {
    const info = callErrorReason(code, detail)
    if (!info) return
    const c = callStateRef.current
    if (!c || c.dir !== "out") return
    if (c.state !== "calling" && c.state !== "connecting") return
    callDebug("loi-call-tu-core", { code, detail, callId: c.callId, state: c.state })
    clearCallTimers()
    const s = callSessionRef.current
    if (s) {
      try {
        s.hangup("cancel")
      } catch {}
    }
    callSessionRef.current = null
    pushToast(info.reason)
    closeCallSession()
    const callId = c.callId
    setCall((cur) => (cur && cur.callId === callId ? { ...cur, state: "failed", reason: info.reason } : cur))
    waitCall(() => {
      setCall((cur) => (cur && cur.callId === callId ? null : cur))
      if (callStateRef.current?.callId === callId) callStateRef.current = null
    }, 1600)
  }

  /**
   * Kết thúc cuộc gọi ĐI vì KHÔNG thiết lập được đường tới bên nhận (BƯỚC 4): hết hạn ack,
   * `no_route`, hoặc `ack_no_ui`. Ghi nhận outcome `"unreachable"` MỘT LẦN cho callId, hiện
   * toast lý do rồi ẩn thẻ. KHÔNG đổ chuông 45 giây.
   */
  const finishOutgoingUnreachable = (callId: string, toastText?: string) => {
    const c = callStateRef.current
    if (!c || c.dir !== "out" || c.callId !== callId) return
    if (c.acked) return // đã đổ chuông thật thì không áp dụng "unreachable"
    if (toastText) pushToast(toastText)
    clearCallTimers()
    const s = callSessionRef.current
    if (s) {
      try {
        s.hangup("cancel")
      } catch {}
    }
    callSessionRef.current = null
    finalizeCall("unreachable")
  }

  const hangUp = () => {
    const c = callStateRef.current
    clearCallTimers()
    const s = callSessionRef.current
    if (s) s.hangup()
    callSessionRef.current = null
    if (!c) {
      closeCallSession()
      return
    }
    if (c.state === "calling") {
      // Đang đổ chuông: người nhận ngắt = TỪ CHỐI; người gọi ngắt = HUỶ.
      finalizeCall(c.dir === "out" ? "cancelled" : "rejected")
    } else {
      finalizeCall("completed")
    }
  }

  const acceptIncoming = async () => {
    const s = callSessionRef.current
    if (!s) return
    clearCallTimers()
    setCall((c) => (c ? { ...c, state: "connecting" } : c))
    await s.accept()
    setCallLocalStream(s.localStream)
  }

  const retryFailed = () => {
    const c = callStateRef.current
    if (!c) return
    const kind = c.kind
    const conv = conversations.find((cv) => cv.id === c.convId)
    clearCallTimers()
    closeCallSession()
    setCall(null)
    void startCall(kind, conv)
  }

  const toggleMute = () => {
    setCallMuted((v) => {
      const next = !v
      callSessionRef.current?.setMuted(next)
      return next
    })
  }

  const toggleVideo = () => {
    setCallVideoOff((v) => {
      const next = !v
      callSessionRef.current?.setVideoOff(next)
      return next
    })
  }

  const toggleMinimize = () => {
    setCallMinimized((v) => !v)
  }

  // Ticking timer for duration
  useEffect(() => {
    if (call?.state !== "in-call") {
      if (callRef.current.tick !== null) {
        window.clearInterval(callRef.current.tick)
        callRef.current.tick = null
      }
      return
    }
    callRef.current.tick = window.setInterval(
      () => setCallTick((t) => t + 1),
      500,
    )
    return () => {
      if (callRef.current.tick !== null) {
        window.clearInterval(callRef.current.tick)
        callRef.current.tick = null
      }
    }
  }, [call?.state === "in-call"])

  const callDur = call?.startAt
    ? Math.floor((Date.now() - call.startAt) / 1000)
    : (call?.acc ?? 0)

  // Phòng của cuộc gọi hiện tại (để lấy ảnh đại diện + danh sách người).
  const callConv = call
    ? conversations.find(
        (c) =>
          c.id === call.convId ||
          (call.roomId !== undefined && c.realId === call.roomId),
      ) ?? null
    : null

  // Danh sách người hiển thị trên màn hình gọi (bản thân đứng đầu) — chỉ để vẽ.
  const callRoster = useMemo<CallPerson[]>(() => {
    if (!call) return []
    const byId = new Map<number, CallRosterEntry>()
    const put = (e: CallRosterEntry) => {
      if (!e.id || e.id === meId) return
      const prev = byId.get(e.id)
      byId.set(e.id, {
        id: e.id,
        displayName: prev?.displayName || e.displayName,
        username: prev?.username || e.username,
        avatar: prev?.avatar || e.avatar,
      })
    }
    const isGroupCall = !!callConv?.isGroup
    if (isGroupCall) {
      // Trong cuộc gọi nhóm: CHỈ hiển thị những người thực sự đã chấp nhận / đang tham gia cuộc gọi (call.participants).
      // Người không nghe máy / từ chối / rời nhóm sẽ bị loại bỏ khỏi danh sách người tham gia.
      // Chỉ khi họ ấn "Tham gia" lại thì WebRTC mới phát tín hiệu và thêm họ vào cuộc gọi.
      for (const p of call.participants ?? []) {
        if (!p.userId || p.userId === meId) continue
        const convMember = callConv?.members?.find((m) => m.id === p.userId)
        const dirPerson = getPerson(p.userId)
        const friend = friendList?.find((f) => f.id === p.userId)
        put({
          id: p.userId,
          displayName: dirPerson?.name || convMember?.name || friend?.name || p.name,
          username: p.name,
          avatar: dirPerson?.avatar || convMember?.avatar || friend?.avatar,
        })
      }
    } else {
      // Cuộc gọi 1-1: Luôn bảo đảm có đúng một đối tác trò chuyện
      const otherMember = (callConv?.members ?? []).find((m) => m.id !== meId)
      const targetId =
        call.callerId && call.callerId !== meId
          ? call.callerId
          : call.peerId && call.peerId !== meId
            ? call.peerId
            : otherMember?.id
      if (targetId) {
        const dirPerson = getPerson(targetId)
        const friend = friendList?.find((f) => f.id === targetId)
        put({
          id: targetId,
          displayName:
            dirPerson?.name ||
            otherMember?.name ||
            friend?.name ||
            call.name,
          avatar:
            dirPerson?.avatar ||
            otherMember?.avatar ||
            friend?.avatar ||
            callConv?.avatar,
        })
      }
    }
    return buildCallRoster({
      self: {
        id: meId,
        displayName: profile.name,
        username: meUsername ?? undefined,
        avatar: profile.avatar,
        muted: callMuted,
      },
      others: [...byId.values()],
    })
  }, [
    call,
    callConv,
    meId,
    meUsername,
    profile.name,
    profile.avatar,
    callMuted,
    friendList,
  ])

  // Cuộc gọi đang mở: ai CHƯA có trong thư viện thì gọi API hồ sơ MỘT LẦN rồi ghi vào
  // cùng thư viện → màn hình gọi tự chuyển từ chữ viết tắt sang ảnh, không tải lại trang.
  useEffect(() => {
    if (!call) return
    void ensurePeople(
      [
        ...callRoster.filter((p) => !p.isSelf).map((p) => p.userId),
        ...(call.participants ?? []).map((p) => p.userId),
      ],
      { roomId: callConv?.realId },
    )
  }, [call, callRoster, callConv])

  const callTotalCount =
    (call?.participants?.length ?? 0) > 0
      ? (call?.participants?.length ?? 0) + 1
      : callRoster.length

  if (onCallFrameRef) onCallFrameRef.current = handlePeerCall
  if (onCallErrorRef) onCallErrorRef.current = handlePeerError
  useEffect(() => {
    if (onCallFrameRef) onCallFrameRef.current = handlePeerCall
    if (onCallErrorRef) onCallErrorRef.current = handlePeerError
  })

  return {
    call,
    callBusy,
    callDur,
    callMuted,
    callVideoOff,
    callMinimized,
    callLocalStream,
    callRemoteStreams,
    callRoster,
    callTotalCount,
    callSessionRef,
    startCall,
    handlePeerCall,
    handlePeerError,
    hangUp,
    acceptIncoming,
    retryFailed,
    toggleMute,
    toggleVideo,
    toggleMinimize,
    callNetQuality,
    callRemoteMediaState,
  }
}
