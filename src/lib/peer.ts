export interface PeerChatMessage {
  t: string
  roomId: number
  text: string
  clientId: string
  ts: number
  fromUserId: number
  fromUsername: string
  replyToClientId?: string
}

export interface PeerFileFrame {
  type: "file"
  roomId: number
  fileId: string
  name: string
  mime: string
  size: number
  sha256: string
  actualSha256: string
  chunks: number
  fromUserId: number
  fromUsername: string
  replyToClientId?: string
  ok: boolean
  dataB64?: string
  code?: string
}

export interface PresenceFrame {
  type?: "presence"
  userId?: number
  online?: boolean
  lastSeenAt?: number
}

export interface PeerOfflineMsg {
  clientMsgId: string
  roomId: number
  senderId: number
  contentType: string
  text: string
  sentAt: number
  offline?: boolean
  senderUsername?: string
}

export interface PeerHistoryMsg {
  clientMsgId: string
  roomId: number
  senderId: number
  contentType: string
  /** null khi khoá E2E đang khoá/lệch khoá nên không giải mã được nội dung cục bộ. */
  text: string | null
  sentAt: number
  direction: "in" | "out"
  status: string
}

/** Phản hồi `hello_res`: trạng thái gắn của một Peer Core vừa dò được. */
export interface PeerHelloFrame {
  type: "hello_res"
  state: "unbound" | "bound"
  nonce: string
  port: number
  apiPort?: number
  boundUserId?: number
  boundUsername?: string
  boundPublicId?: string
  e2e?: "unlocked" | "locked" | "no_keystore" | "empty_passphrase" | string
}

/** Loại cuộc gọi: thoại (audio) hoặc video (audio+video). */
export type CallKind = "voice" | "video"

/** Tín hiệu thiết lập cuộc gọi (WebRTC) đi qua kênh sự kiện nhẹ của Peer Core. */
export type CallSignal =
  | "invite"
  | "accept"
  | "reject"
  | "cancel"
  | "end"
  | "offer"
  | "answer"
  | "ice"

/**
 * Trạng thái gửi một khung cuộc gọi, do Peer Core bên gọi báo về (frame `call_state`):
 * - `pending`: khung còn nằm trong hàng đợi chờ bắt tay PeerLink — CHƯA coi là đã gửi.
 * - `sent`: đã ghi vào PeerLink READY hoặc Relay nhận (`via = direct | relay`).
 * - `no_route`: không có đường tới bất kỳ thành viên nào (không link, không relay).
 * - `acked`: Core bên nhận đã đẩy khung xuống ≥1 UI WebSocket và xác nhận ngược lại.
 * - `ack_no_ui`: Core bên nhận đã nhận nhưng KHÔNG có UI nào đang nối.
 */
export type CallDeliveryState =
  | "pending"
  | "sent"
  | "no_route"
  | "acked"
  | "ack_no_ui"

export interface CallCandidate {
  candidate?: string
  sdpMid?: string
  sdpMLineIndex?: number
}

/** Payload FE gửi lên Peer Core cho mỗi tín hiệu cuộc gọi. */
export interface CallSignalPayload {
  type: "call"
  roomId: number
  signal: CallSignal
  callId: string
  kind?: CallKind
  /** userId đích cho offer/answer/ice (bỏ trống với invite/accept/reject/cancel/end). */
  to?: number
  callerName?: string
  sdp?: string
  sdpType?: "offer" | "answer"
  candidate?: CallCandidate
  reason?: string
}

export interface PeerUiFrame {
  type:
    | "hello_res"
    | "bound"
    | "unbound"
    | "bind_error"
    | "session_expired"
    | "ui_ok"
    | "need_ticket"
    | "ticket_ok"
    | "ticket_error"
    | "message"
    | "seen"
    | "pong"
    | "error"
    | "typing"
    | "edit"
    | "recall"
    | "reaction"
    | "file"
    | "udp_state"
    | "unlocked"
    | "unlock_failed"
    | "locked"
    | "logged_out"
    | "key_changed"
    | "peer_key_changed"
    | "offline_message"
    | "offline_pull_done"
    | "retry_done"
    | "history"
    | "passphrase_changed"
    | "keystore_reset"
    | "presence"
    | "send_state"
    | "server_state"
    | "decrypt_failed"
    | "friend_accepted"
    | "call"
    | "call_state"
    | "decrypt_batch_res"
    | "file_begin_ok"
    | "file_begin_err"
    | "file_ticket_ok"
    | "file_ticket_err"
    | "file_state"
  room?: unknown
  friend?: unknown
  state?: string
  connected?: boolean
  /** Kênh WS thời gian thực tới Tracker còn mở không (riêng biệt với `connected` = HTTP hoặc WS). */
  realtime?: boolean
  /** Thời điểm (ms epoch) cuối cùng Tracker phản hồi HTTP/WS (không nhạy cảm). */
  http?: number
  tracker?: string
  ws?: string
  attempts?: number
  lastPong?: number
  lastError?: string
  lastErrorAt?: number
  nonce?: string
  port?: number
  boundUserId?: number
  boundUsername?: string
  boundPublicId?: string
  publicId?: string
  e2e?: string
  identity?: { userId: number; username: string }
  apiPort?: number
  transport?: string
  reachable?: boolean
  message?: PeerChatMessage | PeerOfflineMsg
  roomId?: number
  messageId?: string
  clientId?: string
  text?: string
  emoji?: string
  remove?: boolean
  ts?: number
  fromUserId?: number
  fromUsername?: string
  code?: string
  fileId?: string
  name?: string
  mime?: string
  size?: number
  sha256?: string
  actualSha256?: string
  chunks?: number
  ok?: boolean
  dataB64?: string
  /** Vé upload một lần do `file_begin` cấp; UI POST byte thô lên `/files/upload/<token>`. */
  uploadToken?: string
  /** Vé tải một lần do `file_open` cấp; UI GET byte thô từ `/files/<fileId>?ticket=`. */
  ticket?: string
  /** Giới hạn kích thước tệp Core chấp nhận (byte). */
  maxBytes?: number
  /** Tiến độ 0–100 khi đang truyền. */
  progress?: number
  direction?: "in" | "out"
  /** Mã ghép phản hồi cho `file_begin`/`file_open` (Core sao lại nguyên văn). */
  reqId?: string
  /** frame `file_state`: số peer đã xác nhận nhận tệp. */
  sentTo?: number
  /** frame `file_state`: tổng số người nhận của tệp. */
  total?: number
  /** frame `file_state`: đang truyền chậm (cửa sổ đã co). */
  weak?: boolean
  /** frame `file_state`: trạng thái từng người nhận trong phòng nhóm. */
  recipients?: { userId: number; state: string }[]
  fingerprint?: string
  created?: boolean
  keyChanged?: boolean
  error?: string
  count?: number
  serverId?: number
  messages?: PeerHistoryMsg[]
  userId?: number
  online?: boolean
  username?: string
  lastSeenAt?: number
  hasMore?: boolean
  before?: number
  undecryptable?: boolean
  /** Tin đã cạn số lần thử tự động — UI cho phép bấm "Gửi lại". */
  retryable?: boolean
  /** Tín hiệu cuộc gọi (WebRTC) — xem {@link CallSignal}. */
  signal?: CallSignal
  callId?: string
  kind?: CallKind
  to?: number
  callerName?: string
  sdp?: string
  sdpType?: "offer" | "answer"
  candidate?: CallCandidate
  reason?: string
  items?: Array<{ clientMsgId: string; roomId: number; text: string; status?: string; contentType?: string }>
  durationMs?: number
  lockoutSeconds?: number
  remainingAttempts?: number
  /** frame `call_state`: trạng thái gửi khung cuộc gọi (xem {@link CallDeliveryState}). */
  callState?: CallDeliveryState
  /** đường đã dùng khi `callState === "sent"`/`"acked"`. */
  via?: string
  /** frame `call_state`: số UI đã nhận ở Core bên nhận (khi `acked`/`ack_no_ui`). */
  uiCount?: number
}

/** Thời gian chờ tối đa cho `hello_res` sau khi mở được socket (ms). */
const HELLO_TIMEOUT = 1200
/** Nhịp thử cổng kế tiếp trong một lượt dò (ms). */
const PORT_STEP_DELAY = 200
/** Nhịp dò lại sau khi đã từng nói chuyện được với Peer Core (ms). */
const REBOUND_DELAY = 3000
/** Nhịp dò lại tối đa khi không tìm thấy Peer Core (backoff ≤ 10s). */
const MAX_SCAN_DELAY = 10000

/** Quyết định của FE khi nhận `hello_res` từ một Peer Core. */
export type PeerHelloDecision = "bind" | "adopt" | "skip"

/**
 * Chọn hành động cho một `hello_res`:
 * - `bind`: Peer Core chưa gắn → xin vé rồi bind.
 * - `adopt`: đã gắn đúng tài khoản hiện tại → dùng luôn.
 * - `skip`: đang gắn tài khoản khác (hoặc chưa biết id mình) → bỏ qua, dò cổng kế tiếp.
 */
export function decideHello(
  h: Pick<PeerHelloFrame, "state" | "boundUserId">,
  myUserId: number,
): PeerHelloDecision {
  if (h.state === "unbound") return "bind"
  if (myUserId && h.boundUserId === myUserId) return "adopt"
  return "skip"
}

/**
 * Quyết định một `hello_res` có phải là Peer Core mà người dùng đã xác nhận "Giải phóng
 * và dùng lại" — tức một Peer Core đang gắn tài khoản khác ở đúng cổng đã chọn.
 * Khi đó FE gửi `unbind` rồi gắn lại tài khoản hiện tại.
 */
export function shouldReleaseHello(
  h: Pick<PeerHelloFrame, "state" | "boundUserId" | "port">,
  connectedPort: number,
  releasePort: number,
  myUserId: number,
): boolean {
  if (!releasePort) return false
  if (h.port !== releasePort && connectedPort !== releasePort) return false
  return h.state === "bound" && h.boundUserId !== myUserId
}

/**
 * Câu chữ banner khi gặp Peer Core đang gắn tài khoản khác.
 * `noFree` = đã dò hết dải mà vẫn không còn cổng trống (mọi core đều bị tài khoản khác chiếm).
 */
export function otherAccountLabel(noFree: boolean, username?: string): string {
  const who = username ? ` (${username})` : ""
  return noFree
    ? `Hết Peer Core trống${who} — mở thêm core hoặc bấm "Giải phóng và dùng lại"`
    : `Peer Core đang gắn tài khoản khác${who} — đang dò tiếp…`
}

export class PeerClient {
  connected = false
  port = 0
  /** Thông tin `hello_res` gần nhất (nếu đã gặp Peer Core). */
  hello: PeerHelloFrame | null = null
  onOpen?: () => void
  onHello?: (h: PeerHelloFrame) => void
  onClose?: () => void
  onFrame?: (f: PeerUiFrame) => void
  /** Gọi khi vừa dò hết một vòng cả dải cổng; tham số = số cổng gắn tài khoản khác đã gặp. */
  onScanSweep?: (otherCount: number) => void

  private ws: WebSocket | null = null
  private otherPorts = new Set<number>()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private pendingReqs = new Map<
    string,
    { types: Set<string>; resolve: (f: PeerUiFrame) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private wantClose = false
  private gotHello = false
  private forceAdvance = false
  private scanCycles = 0
  private ports: number[]
  private idx = 0

  constructor(portOrPorts?: number | number[]) {
    this.ports =
      Array.isArray(portOrPorts) && portOrPorts.length > 0
        ? portOrPorts.slice()
        : peerPortCandidates()
    if (this.ports.length === 0) this.ports = [defaultPeerPort()]
    this.port = this.ports[0]
  }

  connect() {
    this.wantClose = false
    this.gotHello = false
    this.scanCycles = 0
    this.otherPorts.clear()
    this.open()
  }

  private open() {
    if (this.wantClose) return
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    )
      return
    const port = this.ports[this.idx % this.ports.length]
    this.port = port
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ui`)
      this.ws = ws
      ws.onopen = () => {
        this.connected = true
        this.gotHello = false
        this.port = port
        this.onOpen?.()
        // Chào hỏi để Peer Core trả lời trạng thái gắn + nonce.
        this.send({ type: "hello" })
        this.helloTimer = setTimeout(() => {
          this.helloTimer = null
          if (!this.gotHello && !this.wantClose) {
            // Cổng mở nhưng không phải Peer Core của ta — sang cổng kế tiếp.
            this.skipCurrent()
          }
        }, HELLO_TIMEOUT)
      }
      ws.onmessage = (e) => {
        let f: PeerUiFrame
        try {
          f = JSON.parse(e.data as string) as PeerUiFrame
        } catch {
          return
        }
        if (f.type === "hello_res") {
          this.gotHello = true
          this.scanCycles = 0
          if (this.helloTimer) {
            clearTimeout(this.helloTimer)
            this.helloTimer = null
          }
          this.hello = f as PeerHelloFrame
          this.onHello?.(f as PeerHelloFrame)
          return
        }
        if (f.reqId) {
          const p = this.pendingReqs.get(f.reqId)
          if (p && p.types.has(f.type)) {
            this.pendingReqs.delete(f.reqId)
            p.resolve(f)
            return
          }
        }
        this.onFrame?.(f)
      }
      ws.onclose = () => {
        const wasConnected = this.connected
        this.connected = false
        if (this.ws === ws) this.ws = null
        this.failPending("PEER_CLOSED")
        if (this.helloTimer) {
          clearTimeout(this.helloTimer)
          this.helloTimer = null
        }
        this.onClose?.()
        if (this.wantClose) return
        const skipped = this.forceAdvance
        this.forceAdvance = false
        let delay: number
        if (this.gotHello && !skipped && wasConnected) {
          // Đã gặp Peer Core rồi mà mất kết nối → thử lại cùng cổng sau ít giây.
          delay = REBOUND_DELAY
        } else {
          // Chưa gặp ai, hết hạn hello, hoặc chủ động bỏ qua cổng → sang cổng kế tiếp.
          this.idx = (this.idx + 1) % this.ports.length
          if (this.idx === 0) {
            // Vừa quét hết một vòng mà không thấy ai → giãn nhịp dần (trừ khi chủ động bỏ qua).
            this.scanCycles += 1
            this.onScanSweep?.(this.otherPorts.size)
            delay = skipped ? PORT_STEP_DELAY : Math.min(MAX_SCAN_DELAY, REBOUND_DELAY * this.scanCycles)
          } else {
            delay = PORT_STEP_DELAY
          }
        }
        this.retryTimer = setTimeout(() => this.open(), delay)
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
    } catch {
      this.retryTimer = setTimeout(() => this.open(), PORT_STEP_DELAY)
    }
  }

  /** Bỏ qua cổng hiện tại (đóng socket; vòng dò sẽ chuyển cổng kế tiếp). */
  skipCurrent() {
    this.forceAdvance = true
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
  }

  /** Ghi nhớ một cổng đang gắn tài khoản khác (FE gọi khi quyết định bỏ qua cổng đó). */
  noteOtherPort(port: number) {
    if (port) this.otherPorts.add(port)
  }

  /** Xoá sổ cổng "tài khoản khác" (gọi khi đã gắn được cổng của mình). */
  resetOtherPorts() {
    this.otherPorts.clear()
  }

  /**
   * Ghim vào một cổng cụ thể rồi kết nối lại ngay. Dùng khi người dùng xác nhận
   * "Giải phóng và dùng lại" một Peer Core đang gắn tài khoản khác.
   */
  focusPort(port: number) {
    if (!port) return
    this.ports = [port]
    this.idx = 0
    this.scanCycles = 0
    this.gotHello = false
    this.wantClose = false
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const cur = this.ws
    if (!cur || cur.readyState === WebSocket.CLOSED || cur.readyState === WebSocket.CLOSING) {
      this.ws = null
      this.open()
      return
    }
    // Đóng chủ động → vòng dò mở lại đúng cổng này ở nhịp nhanh.
    this.forceAdvance = true
    try {
      cur.close()
    } catch {
      /* ignore */
    }
  }

  send(frame: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame))
      return true
    }
    return false
  }

  /** Kết thúc mọi yêu cầu đang chờ bằng lỗi (socket đóng) để UI không treo. */
  private failPending(error: string) {
    for (const [, p] of this.pendingReqs) {
      clearTimeout(p.timer)
      p.resolve({ type: "error", error } as PeerUiFrame)
    }
    this.pendingReqs.clear()
  }

  /**
   * Gửi một lệnh cần phản hồi và chờ đúng khung `okType`/`errType` cùng `reqId`
   * (Core sao lại `reqId`). Hết hạn → lỗi `TIMEOUT`.
   */
  private request(
    reqId: string,
    okType: string,
    errType: string,
    frame: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<PeerUiFrame> {
    const p = new Promise<PeerUiFrame>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReqs.delete(reqId)
        resolve({ type: errType, error: "TIMEOUT" } as PeerUiFrame)
      }, timeoutMs)
      this.pendingReqs.set(reqId, { types: new Set([okType, errType]), resolve, timer })
    })
    if (!this.send({ ...frame, reqId })) {
      const entry = this.pendingReqs.get(reqId)
      if (entry) {
        clearTimeout(entry.timer)
        this.pendingReqs.delete(reqId)
        return Promise.resolve({ type: errType, error: "NO_PEER" } as PeerUiFrame)
      }
    }
    return p
  }

  /** Xin fileId + vé upload một lần cho một tệp sắp gửi. */
  beginFileUpload(roomId: number, name: string, mime: string, size: number, timeoutMs = 8000) {
    const reqId = newReqId()
    return this.request(reqId, "file_begin_ok", "file_begin_err", {
      type: "file_begin",
      roomId,
      name,
      mime,
      size,
    }, timeoutMs)
  }

  /** Xin vé tải một lần cho một tệp đã lưu trên Core cục bộ. */
  openFile(fileId: string, timeoutMs = 8000) {
    const reqId = newReqId()
    return this.request(reqId, "file_ticket_ok", "file_ticket_err", {
      type: "file_open",
      fileId,
    }, timeoutMs)
  }

  /** Hủy tệp đang gửi/nhận (Core gửi `file_cancel` cho phía bên kia). */
  cancelFile(fileId: string) {
    return this.send({ type: "file_cancel", fileId })
  }

  /** Gửi lại tệp đã hủy/lỗi từ dữ liệu Core còn trên đĩa. */
  retryFile(fileId: string) {
    return this.send({ type: "file_retry", fileId })
  }

  /** Gửi yêu cầu gắn tài khoản hiện tại vào Peer Core bằng vé một lần. */
  bind(ticket: string) {
    return this.send({ type: "bind", ticket })
  }

  /** Bỏ gắn Peer Core (khoá E2E trong RAM, đóng link mesh, xoá chìa phiên). */
  unbind() {
    return this.send({ type: "unbind" })
  }

  /** Mở khoá khoá E2E bằng passphrase (lần đầu sẽ tạo khoá mới). */
  unlock(passphrase: string) {
    return this.send({ type: "unlock", passphrase })
  }

  /** Kéo hộp thư ngoại tuyến từ server về ngay. */
  pullOffline() {
    return this.send({ type: "offline_pull" })
  }

  /** Gửi lại các phong bì E2E đang chờ trong outbox. */
  retry() {
    return this.send({ type: "retry" })
  }

  /** Gửi lại MỘT tin cụ thể (nút "Gửi lại" khi tin đã cạn lượt thử tự động). */
  retryMessage(clientId: string) {
    return this.send({ type: "retry", clientId })
  }

  /** Đo độ trễ tới Peer Core; Peer Core trả frame `pong` kèm lại `ts` đã gửi. */
  ping() {
    return this.send({ type: "ping", ts: Date.now() })
  }

  /** Xin lịch sử đã giải mã cục bộ của một phòng. `before` = nạp trang cũ hơn. */
  requestHistory(roomId: number, limit = 50, before?: number) {
    return this.send(
      before === undefined
        ? { type: "history", roomId, limit }
        : { type: "history", roomId, limit, before },
    )
  }

  /** Gửi một tín hiệu thiết lập cuộc gọi (WebRTC) qua Peer Core. */
  sendCall(payload: Omit<CallSignalPayload, "type">) {
    return this.send({ type: "call", ...payload })
  }

  /** Đổi passphrase keystore E2E (re-encrypt, giữ nguyên khóa). */
  changePassphrase(oldPassphrase: string, newPassphrase: string) {
    return this.send({ type: "change_passphrase", oldPassphrase, newPassphrase })
  }

  /** Xóa keystore E2E (quên mật khẩu) — lần mở khóa sau tạo khóa mới. */
  resetKeystore() {
    return this.send({ type: "reset_keystore" })
  }

  /** Thu hồi phiên Peer Core khi đăng xuất (= bỏ gắn). */
  logout() {
    return this.unbind()
  }

  close() {
    this.wantClose = true
    this.failPending("CLOSED")
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.helloTimer) {
      clearTimeout(this.helloTimer)
      this.helloTimer = null
    }
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    this.connected = false
    this.hello = null
  }
}

/** Mã yêu cầu ngẫu nhiên để ghép phản hồi của Core (upload/download tệp). */
const newReqId = (): string =>
  `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const defaultPeerPort = (): number => {
  const env = (import.meta as { env?: Record<string, string> }).env
  const fromEnv = parsePeerPortList(env?.VITE_PEER_UI_PORT)
  if (fromEnv.length > 0) return fromEnv[0]
  return 48001
}

/**
 * Phân tích danh sách cổng từ biến môi trường (hàm thuần để kiểm thử):
 * nhận "48001" hoặc danh sách "48112,48212"; bỏ giá trị không hợp lệ.
 */
export const parsePeerPortList = (raw: string | undefined): number[] => {
  if (!raw) return []
  const out: number[] = []
  for (const part of raw.split(",")) {
    const n = Number(part.trim())
    if (Number.isInteger(n) && n > 0 && n < 65536) out.push(n)
  }
  return out
}

/**
 * Danh sách cổng UI ứng viên để dò Peer Core cục bộ.
 * Nếu có `VITE_PEER_UI_PORT` (một cổng hoặc danh sách "a,b") thì dùng đúng danh sách đó,
 * ngược lại dò dải 48001–48010 do Peer Core tự chọn.
 * Chọn dải < 49152 để tránh dải cổng động (ephemeral) của Windows (49152–65535).
 */
export const peerPortCandidates = (): number[] => {
  const env = (import.meta as { env?: Record<string, string> }).env
  const fromEnv = parsePeerPortList(env?.VITE_PEER_UI_PORT)
  if (fromEnv.length > 0) return fromEnv
  return Array.from({ length: 10 }, (_, i) => 48001 + i)
}
