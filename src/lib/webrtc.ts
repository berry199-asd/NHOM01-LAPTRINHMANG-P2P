import type { CallKind, CallSignalPayload, PeerUiFrame } from "./peer"
import { callDebug } from "./callDebug.ts"

/**
 * Phiên cuộc gọi WebRTC (thoại/video) dùng tín hiệu đi qua Peer Core (kênh sự kiện nhẹ).
 *
 * Mô hình mesh cho gọi nhóm: mỗi cặp người tham gia giữ một {@link RTCPeerConnection}
 * riêng. Để tránh "glare" (hai bên cùng tạo offer), bên có id nhỏ hơn chủ động offer.
 * Người nhận `accept` (báo có mặt) sẽ bổ sung thành viên và kết nối theo quy tắc trên.
 *
 * Phần thuần (không phụ thuộc DOM) tách riêng để kiểm thử: {@link shouldInitiateOffer},
 * {@link normalizeCandidate}.
 */

export type CallPhase = "ringing-out" | "ringing-in" | "connecting" | "active"

export interface CallParticipantInfo {
  userId: number
  name: string
}

export interface CallSessionOptions {
  callId: string
  roomId: number
  kind: CallKind
  myId: number
  myName: string
  /** true nếu ta là người khởi tạo cuộc gọi. */
  isCaller: boolean
  /** Người khởi tạo (với người nhận, lấy từ frame `invite`). */
  callerId: number
  callerName: string
  /** Danh sách userId dự kiến tham gia (cuộc gọi nhóm / 1-1) — dùng để không ngắt sớm khi chỉ 1 người bận. */
  expectedPeerIds?: number[]
  /**
   * Gửi tín hiệu lên Peer Core. Trả `false` nếu KHÔNG gửi được (kênh UI WS chưa mở)
   * để phiên gọi báo lỗi ngay thay vì đổ chuông chờ vô ích.
   */
  send: (payload: Omit<CallSignalPayload, "type">) => boolean | void
  onParticipants: (list: CallParticipantInfo[]) => void
  onRemoteStream: (userId: number, stream: MediaStream | null) => void
  onEnded: (reason: string) => void
  onError: (message: string) => void
  onPhase: (phase: CallPhase) => void
  onNetworkState?: (state: "good" | "weak" | "disconnected", detail?: string) => void
  onRemoteMediaState?: (userId: number, state: { videoOff?: boolean; audioOff?: boolean }) => void
  iceServers?: RTCIceServer[]
}

/** STUN công cộng mặc định; đủ cho LAN/ZeroTier, giúp vượt NAT đơn giản. */
const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]

/** Quy tắc tránh glare: bên có id nhỏ hơn chủ động tạo offer. */
export function shouldInitiateOffer(myId: number, otherId: number): boolean {
  return myId < otherId
}

/** Chuẩn hoá ICE candidate nhận từ frame thành dạng `addIceCandidate` chấp nhận. */
export function normalizeCandidate(
  c: { candidate?: string; sdpMid?: string; sdpMLineIndex?: number } | undefined,
): RTCIceCandidateInit {
  return {
    candidate: c?.candidate ?? "",
    sdpMid: c?.sdpMid ?? null,
    sdpMLineIndex: c?.sdpMLineIndex ?? null,
  }
}

/** Tăng băng thông video lên chuẩn HD/Full-HD sắc nét (mặc định 3.5 Mbps). */
export function boostVideoSdp(sdp: string, bitrateKbps = 3500): string {
  if (!sdp || !sdp.includes("m=video")) return sdp
  let res = sdp
  if (/b=AS:\d+/.test(res)) {
    res = res.replace(/b=AS:\d+/g, `b=AS:${bitrateKbps}`)
  } else {
    res = res.replace(
      /(m=video [^\r\n]+[\r\n]+)/,
      `$1b=AS:${bitrateKbps}\r\nb=TIAS:${bitrateKbps * 1000}\r\n`,
    )
  }
  // Thêm thông số x-google-min-bitrate / x-google-start-bitrate để Chrome không tự hạ độ phân giải khi khởi đầu
  const minKbps = Math.floor(bitrateKbps * 0.4)
  const startKbps = Math.floor(bitrateKbps * 0.8)
  res = res.replace(/(a=fmtp:\d+ [^\r\n]+)/g, (match) => {
    if (match.includes("x-google-min-bitrate")) return match
    return `${match};x-google-min-bitrate=${minKbps};x-google-start-bitrate=${startKbps};x-google-max-bitrate=${bitrateKbps}`
  })
  return res
}

export class CallSession {
  readonly callId: string
  readonly roomId: number
  readonly kind: CallKind
  readonly isCaller: boolean
  readonly callerId: number

  localStream: MediaStream | null = null
  phase: CallPhase

  private readonly myId: number
  private readonly myName: string
  private readonly callerName: string
  private readonly send: CallSessionOptions["send"]
  private readonly onParticipants: CallSessionOptions["onParticipants"]
  private readonly onRemoteStream: CallSessionOptions["onRemoteStream"]
  private readonly onEnded: CallSessionOptions["onEnded"]
  private readonly onError: CallSessionOptions["onError"]
  private readonly onPhase: CallSessionOptions["onPhase"]
  private readonly onNetworkState?: CallSessionOptions["onNetworkState"]
  private readonly iceServers: RTCIceServer[]
  private readonly reconnectTimers = new Map<number, any>()

  private readonly pcs = new Map<number, RTCPeerConnection>()
  private readonly videoSenders = new Map<number, RTCRtpSender>()
  private readonly dataChannels = new Map<number, RTCDataChannel>()
  private readonly remoteVideoOff = new Map<number, boolean>()
  private readonly remoteAudioOff = new Map<number, boolean>()
  private readonly onRemoteMediaState?: CallSessionOptions["onRemoteMediaState"]
  private isVideoOff = false
  private isMuted = false
  private readonly remoteStreams = new Map<number, MediaStream>()
  private readonly names = new Map<number, string>()
  private readonly roster = new Set<number>()
  private readonly pendingPeers = new Set<number>()
  private readonly pending = new Map<number, RTCIceCandidateInit[]>()
  private joined = false
  private finished = false

  get isFinished(): boolean {
    return this.finished
  }

  get isJoined(): boolean {
    return this.joined
  }

  get currentPhase(): CallPhase {
    return this.phase
  }

  get activeCallId(): string {
    return this.callId
  }

  get activeRoomId(): number {
    return this.roomId
  }

  constructor(opts: CallSessionOptions) {
    this.callId = opts.callId
    this.roomId = opts.roomId
    this.kind = opts.kind
    this.myId = opts.myId
    this.myName = opts.myName
    this.isCaller = opts.isCaller
    this.callerId = opts.callerId
    this.callerName = opts.callerName
    this.send = opts.send
    this.onParticipants = opts.onParticipants
    this.onRemoteStream = opts.onRemoteStream
    this.onEnded = opts.onEnded
    this.onError = opts.onError
    this.onPhase = opts.onPhase
    this.onNetworkState = opts.onNetworkState
    this.onRemoteMediaState = opts.onRemoteMediaState
    this.iceServers = opts.iceServers ?? DEFAULT_ICE
    this.phase = opts.isCaller ? "ringing-out" : "ringing-in"
    if (opts.expectedPeerIds && opts.expectedPeerIds.length > 0) {
      for (const id of opts.expectedPeerIds) {
        if (id && id !== opts.myId) {
          this.pendingPeers.add(id)
        }
      }
    }
  }

  /** Bắt đầu cuộc gọi (người khởi tạo): xin media rồi gửi `invite`. */
  async start() {
    if (!(await this.acquireMedia())) return
    this.joined = true
    this.setPhase("ringing-out")
    const ok = this.send({
      signal: "invite",
      callId: this.callId,
      roomId: this.roomId,
      kind: this.kind,
      callerName: this.myName,
    })
    // Kênh UI WS chưa mở → lời mời không đi được; báo lỗi ngay (không treo chuông 45s).
    if (ok === false) {
      this.fail("Chưa kết nối được Peer Core — không gửi được lời mời")
    }
  }

  /** Trả lời cuộc gọi đến: xin media, gửi `accept` để báo có mặt. */
  async accept() {
    if (!(await this.acquireMedia())) return
    this.joined = true
    this.setPhase("connecting")
    const ok = this.send({ signal: "accept", callId: this.callId, roomId: this.roomId })
    if (ok === false) {
      this.fail("Chưa kết nối được Peer Core — không trả lời được cuộc gọi")
    }
  }

  setMuted(muted: boolean) {
    this.isMuted = muted
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
    const msg = JSON.stringify({ type: "media_state", audioOff: muted })
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === "open") {
        try { dc.send(msg) } catch {}
      }
    }
  }

  setVideoOff(off: boolean) {
    this.isVideoOff = off
    const videoTrack = this.localStream?.getVideoTracks()[0] ?? null
    if (videoTrack) {
      videoTrack.enabled = !off
    }
    for (const sender of this.videoSenders.values()) {
      try {
        void sender.replaceTrack(off ? null : videoTrack).then(() => {
          if (!off) this.tuneVideoSender(sender)
        })
      } catch {}
    }
    const msg = JSON.stringify({ type: "media_state", videoOff: off })
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === "open") {
        try { dc.send(msg) } catch {}
      }
    }
  }

  /** Kết thúc chủ động: gửi tín hiệu phù hợp rồi dọn tài nguyên (không gọi `onEnded`). */
  hangup(reason?: string) {
    if (!this.finished) {
      if (!this.joined) {
        this.send({
          signal: this.isCaller ? "cancel" : "reject",
          callId: this.callId,
          roomId: this.roomId,
          reason,
        })
      } else {
        this.send({ signal: "end", callId: this.callId, roomId: this.roomId, reason })
      }
    }
    this.cleanup()
  }

  /** Dọn tài nguyên không gửi tín hiệu (dùng khi cuộc gọi đã kết thúc từ xa). */
  close() {
    this.cleanup()
  }

  handle(frame: PeerUiFrame) {
    if (!frame.callId || frame.callId !== this.callId) {
      // Không phải cuộc gọi của phiên này (vd gói của cuộc gọi khác) — bỏ qua.
      callDebug("bo-qua-khac-callId", {
        signal: frame.signal,
        callId: frame.callId,
        roomId: frame.roomId,
      })
      return
    }
    const from = frame.fromUserId ?? 0
    if (!from || from === this.myId) {
      callDebug("bo-qua-nguon-khong-hop-le", {
        signal: frame.signal,
        callId: frame.callId,
        fromUserId: from,
        myId: this.myId,
      })
      return
    }
    if (frame.fromUsername) this.names.set(from, frame.fromUsername)
    callDebug("nhan-tin-hieu", {
      signal: frame.signal,
      callId: frame.callId,
      roomId: frame.roomId,
      fromUserId: from,
      hasSdp: typeof frame.sdp === "string" && frame.sdp.length > 0,
      hasCandidate: frame.candidate !== undefined && frame.candidate !== null,
    })

    switch (frame.signal) {
      case "cancel":
        this.pendingPeers.clear()
        this.finish(frame.reason === "timeout" ? "Không có ai trả lời. Cuộc gọi đã kết thúc." : "Đã huỷ cuộc gọi")
        return
      case "end":
        this.pendingPeers.delete(from)
        this.removeParticipant(from)
        if (this.roster.size === 0 && this.pendingPeers.size === 0) {
          this.finish("Cuộc gọi đã kết thúc")
        }
        return
      case "reject":
        this.pendingPeers.delete(from)
        this.removeParticipant(from)
        if (this.roster.size === 0 && this.pendingPeers.size === 0) {
          this.finish(
            frame.reason === "busy"
              ? "busy"
              : this.isCaller
                ? "Đã từ chối cuộc gọi"
                : "Cuộc gọi đã kết thúc",
          )
        }
        return
      default:
        break
    }

    if (!this.joined) return

    switch (frame.signal) {
      case "accept": {
        this.pendingPeers.delete(from)
        const isNew = !this.roster.has(from)
        this.addParticipant(from, frame.fromUsername)
        if (isNew) {
          if (shouldInitiateOffer(this.myId, from)) void this.makeOffer(from)
          else
            this.send({
              signal: "accept",
              callId: this.callId,
              roomId: this.roomId,
              to: from,
            })
        }
        break
      }
      case "offer":
        this.addParticipant(from, frame.fromUsername)
        if (frame.sdp) void this.onOffer(from, frame.sdp)
        break
      case "answer":
        if (frame.sdp) void this.onAnswer(from, frame.sdp)
        break
      case "ice":
        void this.onIce(from, normalizeCandidate(frame.candidate))
        break
      default:
        break
    }
  }

  private setPhase(phase: CallPhase) {
    if (this.phase === phase) return
    this.phase = phase
    this.onPhase(phase)
  }

  private async acquireMedia(): Promise<boolean> {
    if (this.localStream) return true
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined
    if (!md || typeof md.getUserMedia !== "function") {
      this.fail(
        this.kind === "video"
          ? "Trình duyệt chặn mic/camera — cần HTTPS hoặc localhost"
          : "Trình duyệt chặn micro — cần HTTPS hoặc localhost",
      )
      return false
    }
    if (this.kind === "video") {
      try {
        this.localStream = await md.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: "user",
          },
        })
        return true
      } catch (videoErr) {
        callDebug("acquire-video-loi-thu-audio", { err: String(videoErr) })
        // Fallback sang âm thanh nếu camera đang bị chiếm hoặc không có thiết bị
        try {
          this.localStream = await md.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          })
          this.onError("Không mở được camera (có thể thiết bị bận hoặc chưa cấp quyền) — tiếp tục với âm thanh")
          return true
        } catch {
          this.fail("Không truy cập được micro hoặc camera")
          return false
        }
      }
    }
    try {
      this.localStream = await md.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      return true
    } catch {
      this.fail("Không truy cập được micro")
      return false
    }
  }

  /**
   * Khóa độ phân giải và cấp đủ băng thông cho Video Sender.
   * degradationPreference = "maintain-resolution" ngăn cản WebRTC tự ý hạ độ phân giải khi mạng có độ trễ nhẹ,
   * giữ cho hình ảnh luôn Full-HD / HD sắc nét trên mọi loại màn hình.
   */
  private tuneVideoSender(sender: RTCRtpSender) {
    try {
      const params = sender.getParameters()
      if (!params) return
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      params.degradationPreference = "maintain-resolution"
      params.encodings[0].scaleResolutionDownBy = 1.0
      params.encodings[0].maxBitrate = 3_500_000
      params.encodings[0].maxFramerate = 30
      params.encodings[0].networkPriority = "high"
      sender.setParameters(params).catch(() => {})
    } catch {}
  }

  private ensurePc(userId: number): RTCPeerConnection | null {
    const existing = this.pcs.get(userId)
    if (existing) return existing
    if (typeof RTCPeerConnection === "undefined") {
      this.fail("Trình duyệt không hỗ trợ WebRTC")
      return null
    }
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    if (this.localStream) {
      for (const tr of this.localStream.getTracks()) {
        const sender = pc.addTrack(tr, this.localStream)
        if (tr.kind === "video") {
          this.videoSenders.set(userId, sender)
          if (this.isVideoOff) {
            void sender.replaceTrack(null).catch(() => {})
          }
          this.tuneVideoSender(sender)
        }
      }
    }
    const setupDataChannel = (dc: RTCDataChannel) => {
      this.dataChannels.set(userId, dc)
      dc.onopen = () => {
        try {
          dc.send(
            JSON.stringify({
              type: "media_state",
              videoOff: this.isVideoOff,
              audioOff: this.isMuted,
            }),
          )
        } catch {}
      }
      dc.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === "media_state") {
            if (typeof data.videoOff === "boolean") {
              this.remoteVideoOff.set(userId, data.videoOff)
            }
            if (typeof data.audioOff === "boolean") {
              this.remoteAudioOff.set(userId, data.audioOff)
            }
            this.onRemoteMediaState?.(userId, {
              videoOff: data.videoOff,
              audioOff: data.audioOff,
            })
          }
        } catch {}
      }
      dc.onclose = () => {
        this.dataChannels.delete(userId)
      }
    }

    if (shouldInitiateOffer(this.myId, userId)) {
      try {
        const dc = pc.createDataChannel("media_ctrl")
        setupDataChannel(dc)
      } catch {}
    } else {
      pc.ondatachannel = (ev) => {
        setupDataChannel(ev.channel)
      }
    }

    const remote = new MediaStream()
    this.remoteStreams.set(userId, remote)
    pc.ontrack = (ev) => {
      const streams = ev.streams
      if (streams && streams[0]) {
        for (const tr of streams[0].getTracks()) {
          if (!remote.getTracks().includes(tr)) remote.addTrack(tr)
        }
      } else if (ev.track && !remote.getTracks().includes(ev.track)) {
        remote.addTrack(ev.track)
      }
      this.onRemoteStream(userId, remote)
    }
    pc.onicecandidate = (ev) => {
      const c = ev.candidate
      this.send({
        signal: "ice",
        callId: this.callId,
        roomId: this.roomId,
        to: userId,
        candidate: c
          ? {
              candidate: c.candidate,
              sdpMid: c.sdpMid ?? undefined,
              sdpMLineIndex: c.sdpMLineIndex ?? undefined,
            }
          : {},
      })
    }
    const handleConnChange = () => {
      const cState = pc.connectionState
      const iState = pc.iceConnectionState
      callDebug("webrtc-trang-thai-mang", { userId, connectionState: cState, iceState: iState })
      if (cState === "connected" || iState === "connected" || iState === "completed") {
        const timer = this.reconnectTimers.get(userId)
        if (timer) {
          clearTimeout(timer)
          this.reconnectTimers.delete(userId)
        }
        this.setPhase("active")
        this.onNetworkState?.("good")
      } else if (cState === "disconnected" || iState === "disconnected") {
        this.onNetworkState?.("disconnected", "Mất kết nối — đang thử kết nối lại…")
        if (!this.reconnectTimers.has(userId)) {
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(userId)
            if (pc.connectionState !== "connected" && pc.iceConnectionState !== "connected") {
              this.removeParticipant(userId)
              if (this.roster.size === 0) {
                this.finish("Cuộc gọi kết thúc do mất kết nối mạng")
              }
            }
          }, 20000)
          this.reconnectTimers.set(userId, timer)
        }
        if (typeof (pc as any).restartIce === "function") {
          try {
            (pc as any).restartIce()
          } catch {}
        }
      } else if (cState === "failed" || iState === "failed") {
        this.onNetworkState?.("disconnected", "Mất kết nối mạng")
        if (!this.reconnectTimers.has(userId)) {
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(userId)
            this.removeParticipant(userId)
            if (this.roster.size === 0) {
              this.finish("Cuộc gọi kết thúc do mất kết nối mạng")
            }
          }, 5000)
          this.reconnectTimers.set(userId, timer)
        }
      }
    }
    pc.onconnectionstatechange = handleConnChange
    pc.oniceconnectionstatechange = handleConnChange
    this.pcs.set(userId, pc)
    return pc
  }

  private async makeOffer(userId: number) {
    if (this.pcs.has(userId)) return
    const pc = this.ensurePc(userId)
    if (!pc) return
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      await pc.setLocalDescription(offer)
      const sender = this.videoSenders.get(userId)
      if (sender) this.tuneVideoSender(sender)
      this.send({
        signal: "offer",
        callId: this.callId,
        roomId: this.roomId,
        to: userId,
        sdp: boostVideoSdp(offer.sdp ?? "", 3500),
        sdpType: "offer",
      })
    } catch {
      this.fail("Không tạo được offer")
    }
  }

  private async onOffer(userId: number, sdp: string) {
    const pc = this.ensurePc(userId)
    if (!pc) return
    try {
      await pc.setRemoteDescription({ type: "offer", sdp })
      await this.flushCandidates(userId, pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      const sender = this.videoSenders.get(userId)
      if (sender) this.tuneVideoSender(sender)
      this.send({
        signal: "answer",
        callId: this.callId,
        roomId: this.roomId,
        to: userId,
        sdp: boostVideoSdp(answer.sdp ?? "", 3500),
        sdpType: "answer",
      })
    } catch {
      this.fail("Không xử lý được offer")
    }
  }

  private async onAnswer(userId: number, sdp: string) {
    const pc = this.pcs.get(userId)
    if (!pc) return
    try {
      await pc.setRemoteDescription({ type: "answer", sdp })
      await this.flushCandidates(userId, pc)
      const sender = this.videoSenders.get(userId)
      if (sender) this.tuneVideoSender(sender)
    } catch {
      /* answer đến muộn/sai — bỏ qua, ICE sẽ tự hội tụ hoặc thất bại êm */
    }
  }

  private async onIce(userId: number, cand: RTCIceCandidateInit) {
    const pc = this.pcs.get(userId)
    if (!pc) return
    if (pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(cand)
      } catch {
        /* candidate lỗi — bỏ qua */
      }
    } else {
      const arr = this.pending.get(userId) ?? []
      arr.push(cand)
      this.pending.set(userId, arr)
    }
  }

  private async flushCandidates(userId: number, pc: RTCPeerConnection) {
    const arr = this.pending.get(userId)
    if (!arr) return
    this.pending.delete(userId)
    for (const c of arr) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        /* bỏ qua candidate lỗi */
      }
    }
  }

  private addParticipant(userId: number, name?: string) {
    if (name) this.names.set(userId, name)
    if (!this.roster.has(userId)) {
      this.roster.add(userId)
      this.emitParticipants()
    }
  }

  private removeParticipant(userId: number) {
    this.roster.delete(userId)
    this.names.delete(userId)
    this.videoSenders.delete(userId)
    const dc = this.dataChannels.get(userId)
    if (dc) {
      try { dc.close() } catch {}
      this.dataChannels.delete(userId)
    }
    this.remoteVideoOff.delete(userId)
    this.remoteAudioOff.delete(userId)
    const pc = this.pcs.get(userId)
    if (pc) {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
      this.pcs.delete(userId)
    }
    this.pending.delete(userId)
    if (this.remoteStreams.has(userId)) {
      this.remoteStreams.delete(userId)
      this.onRemoteStream(userId, null)
    }
    this.emitParticipants()
  }

  private emitParticipants() {
    const list: CallParticipantInfo[] = [...this.roster].map((userId) => ({
      userId,
      name: this.names.get(userId) ?? `#${userId}`,
    }))
    this.onParticipants(list)
  }

  private fail(message: string) {
    this.onError(message)
    this.finish(message)
  }

  private finish(reason: string) {
    if (this.finished) return
    this.finished = true
    this.cleanup()
    this.onEnded(reason)
  }

  private cleanup() {
    this.finished = true
    for (const t of this.reconnectTimers.values()) {
      try { clearTimeout(t) } catch {}
    }
    this.reconnectTimers.clear()
    for (const pc of this.pcs.values()) {
      try {
        pc.close()
      } catch {
        /* ignore */
      }
    }
    this.pcs.clear()
    this.videoSenders.clear()
    for (const dc of this.dataChannels.values()) {
      try { dc.close() } catch {}
    }
    this.dataChannels.clear()
    this.remoteVideoOff.clear()
    this.remoteAudioOff.clear()
    this.pending.clear()
    this.remoteStreams.clear()
    if (this.localStream) {
      for (const tr of this.localStream.getTracks()) {
        try {
          tr.stop()
        } catch {
          /* ignore */
        }
      }
      this.localStream = null
    }
  }
}
