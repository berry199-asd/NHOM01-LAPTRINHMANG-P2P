import { useState, useRef, useEffect } from "react"
import {
  PeerClient,
  peerPortCandidates,
  decideHello,
  shouldReleaseHello,
  type PeerHelloFrame,
  type PeerUiFrame,
  type PeerChatMessage,
  type PeerOfflineMsg,
  type PeerHistoryMsg,
} from "../../lib/peer"
import {
  netReduce,
  INITIAL_NET_STATE,
  NET_PING_INTERVAL_MS,
  NET_WEAK_PING_MS,
  NET_DEAD_PING_MS,
  type NetState,
  type NetSample,
} from "../../lib/netQuality"
import { api, type ApiRoom, type ApiPublicUser } from "../../lib/api"

interface UsePeerConnectionOptions {
  meId: number
  meIdRef: React.MutableRefObject<number>
  pushToast: (text: string) => void
  onSessionEnded: () => void
  afterPeerReady: () => void
  onCallFrame: (f: PeerUiFrame) => void
  onCallError: (code: string | undefined, detail?: string) => void
  onChat: (chat: PeerChatMessage) => void
  onHistory: (roomId: number, msgs: PeerHistoryMsg[], hasMore: boolean) => void
  onFile: (f: PeerUiFrame) => void
  onFileState: (f: PeerUiFrame) => void
  onSeen: (roomId: number | undefined, messageId: string | undefined, fromUserId?: number) => void
  onTyping: (roomId: number, username: string, fromUserId?: number) => void
  onEdit: (roomId: number, clientId: string, text: string) => void
  onRecall: (roomId: number, clientId: string) => void
  onReaction: (roomId: number, clientId: string, emoji: string, remove: boolean, fromUsername: string) => void
  onPresence: (userId: number, online: boolean) => void
  onSendState: (roomId: number, clientId: string, state: string, retryable: boolean) => void
  onDecryptFailed: (roomId: number, clientId: string) => void
  onFriendAccepted: (room?: ApiRoom, friend?: ApiPublicUser) => void
  onRoomAdded?: (room: ApiRoom) => void
  onRoomUpdated?: (room: ApiRoom) => void
  onRoomRemoved?: (roomId: number) => void
  onOfflineMessage: (msg: PeerOfflineMsg) => void
  onDecryptBatch?: (items: Array<{ clientMsgId: string; roomId: number; text: string; status?: string; contentType?: string }>) => void
}

export function usePeerConnection({
  meId,
  meIdRef,
  pushToast,
  onSessionEnded,
  afterPeerReady,
  onCallFrame,
  onCallError,
  onChat,
  onHistory,
  onFile,
  onFileState,
  onSeen,
  onTyping,
  onEdit,
  onRecall,
  onReaction,
  onPresence,
  onSendState,
  onDecryptFailed,
  onFriendAccepted,
  onRoomAdded,
  onRoomUpdated,
  onRoomRemoved,
  onOfflineMessage,
  onDecryptBatch,
}: UsePeerConnectionOptions) {
  const [peerPort, setPeerPort] = useState(0)
  const [peerState, setPeerState] = useState<
    "off" | "scanning" | "unbound" | "binding" | "on" | "other_account" | "no_core"
  >("off")
  const [otherPeer, setOtherPeer] = useState<{ port: number; username: string } | null>(null)
  const [noFreeCore, setNoFreeCore] = useState(false)
  const [peerTransport, setPeerTransport] = useState<Record<number, string>>({})
  const [e2eState, setE2eState] = useState<
    "locked" | "unlocking" | "unlocked" | "error" | "no_keystore"
  >("locked")
  const [serverConnected, setServerConnected] = useState(true)
  const [serverRealtime, setServerRealtime] = useState(true)
  const [serverReason, setServerReason] = useState<{
    tracker?: string
    ws?: string
    attempts?: number
    lastPong?: number
    lastError?: string
    lastErrorAt?: number
    http?: number
  } | null>(null)

  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  )
  const [netState, setNetState] = useState<NetState>(INITIAL_NET_STATE)

  const netSignalsRef = useRef({
    browserOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    peerConnected: false,
    serverConnected: true,
    realtime: true,
  })
  const lastProbeRef = useRef<{ ok: boolean; slow: boolean } | null>(null)
  const lastPongOkAtRef = useRef<number | null>(null)
  const pingSentAtRef = useRef<number | null>(null)

  const buildNetSample = (): NetSample => ({
    browserOnline: netSignalsRef.current.browserOnline,
    peerConnected: netSignalsRef.current.peerConnected,
    serverConnected: netSignalsRef.current.serverConnected,
    realtime: netSignalsRef.current.realtime,
    probe: lastProbeRef.current,
  })
  const applyNet = () => setNetState((prev) => netReduce(prev, buildNetSample()))

  const [peerStun, setPeerStun] = useState(
    () => localStorage.getItem("peerStunServers") || "stun.l.google.com:19302",
  )
  const peerRef = useRef<PeerClient | null>(null)
  const peerOnRef = useRef(false)
  const passphraseRef = useRef<string | null>(null)
  const pendingNewPassRef = useRef<string | null>(null)
  const peerApiPortRef = useRef(0)
  const releasePortRef = useRef(0)

  useEffect(() => {
    if (peerState !== "scanning") return
    const t = window.setTimeout(() => {
      setPeerState((s) => (s === "scanning" ? "no_core" : s))
    }, 4000)
    return () => window.clearTimeout(t)
  }, [peerState])

  useEffect(() => {
    const wasOn = netSignalsRef.current.peerConnected
    const nowOn = peerState === "on"
    netSignalsRef.current = {
      browserOnline,
      peerConnected: nowOn,
      serverConnected,
      realtime: serverRealtime,
    }
    if (nowOn && !wasOn) {
      lastPongOkAtRef.current = Date.now()
      lastProbeRef.current = null
    }
    applyNet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserOnline, peerState, serverConnected, serverRealtime])

  const unlockResolverRef = useRef<((res: { ok: boolean; error?: string; remainingAttempts?: number; lockoutSeconds?: number }) => void) | null>(null)
  const changePassResolverRef = useRef<((res: { ok: boolean; error?: string }) => void) | null>(null)

  const unlockWithPassphrase = (passphrase: string): Promise<{
    ok: boolean
    error?: string
    remainingAttempts?: number
    lockoutSeconds?: number
  }> => {
    return new Promise((resolve) => {
      if (!peerOnRef.current || !peerRef.current) {
        resolve({ ok: false, error: "Peer Core chưa kết nối" })
        return
      }
      unlockResolverRef.current = resolve
      setE2eState("unlocking")
      peerRef.current.send({ type: "unlock", passphrase })
    })
  }

  const changePassphraseWithTicket = (ticket: string, newPassphrase: string): Promise<{ ok: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!peerOnRef.current || !peerRef.current) {
        resolve({ ok: false, error: "Peer Core chưa kết nối" })
        return
      }
      changePassResolverRef.current = resolve
      peerRef.current.send({ type: "change_passphrase", ticket, newPassphrase })
    })
  }

  const lockKeystore = () => {
    if (!peerOnRef.current || !peerRef.current) return
    peerRef.current.send({ type: "lock" })
    setE2eState("locked")
    pushToast("Đã khóa mã hóa E2E")
  }

  const requestUnlock = () => {
    setE2eState("locked")
  }

  const maybeUnlock = () => {
    // Không tự động gửi mã khi reload, giữ nguyên trạng thái phiên của Core
  }

  const requestChangePassphrase = () => {
    // Được kích hoạt qua Modal đổi mã bằng Email + OTP
  }

  const requestResetKeystore = () => {
    if (!peerOnRef.current) return
    const ok = window.confirm(
      "Xoá toàn bộ khoá E2E cục bộ? Bạn sẽ không đọc được tin cũ đã mã hoá bằng khoá này nữa.",
    )
    if (!ok) return
    peerRef.current?.send({ type: "reset_keystore" })
  }

  const handleReleasePeer = () => {
    const cand = otherPeer
    const port = cand?.port || peerRef.current?.port || 0
    if (!port) return
    releasePortRef.current = port
    setPeerState("binding")
    peerRef.current?.focusPort(port)
  }

  const applyStun = async () => {
    const v = window.prompt(
      "Máy chủ STUN (nhiều máy thì ngăn cách bởi dấu phẩy, ví dụ stun.a:3478,stun.b:3478):",
      peerStun,
    )
    if (v === null) return
    const trimmed = v.trim()
    setPeerStun(trimmed)
    localStorage.setItem("peerStunServers", trimmed)
    const apiPort = peerApiPortRef.current
    if (!apiPort) {
      pushToast("Chưa nối Peer Core, không đổi được STUN")
      return
    }
    const servers = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/stun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ servers }),
      })
      const data = (await res.json()) as {
        resolved?: boolean
        publicIp?: string
        publicPort?: number
      }
      if (data.resolved) {
        pushToast(`STUN OK: ${data.publicIp}:${data.publicPort}`)
      } else {
        pushToast("STUN không phản hồi (giữ địa chỉ cũ)")
      }
    } catch {
      pushToast("Đổi STUN thất bại")
    }
  }

  const logoutWithPeerRevoke = (onLogout: () => void) => {
    try {
      peerRef.current?.send({ type: "lock" })
      peerRef.current?.logout()
      peerRef.current?.close()
    } catch {}
    setE2eState("locked")
    onLogout()
  }

  useEffect(() => {
    const client = new PeerClient(peerPortCandidates())
    peerRef.current = client
    client.onScanSweep = (otherCount) => setNoFreeCore(otherCount > 0)

    const onPeerReadyInternal = (e2eStatus?: string) => {
      window.setTimeout(() => {
        if (e2eStatus === "unlocked") {
          setE2eState("unlocked")
          afterPeerReady()
        } else if (e2eStatus === "empty_passphrase") {
          client.send({ type: "unlock", passphrase: "" })
        } else if (e2eStatus === "no_keystore") {
          setE2eState("no_keystore")
          afterPeerReady()
        } else {
          setE2eState("locked")
          afterPeerReady()
        }
      }, 100)
    }

    const requestBind = (nonce: string) => {
      setPeerState("binding")
      void api.peerTicket(nonce).then((r) => {
        if (r.ok && r.data?.ticket) {
          if (!client.bind(r.data.ticket)) {
            setPeerState("unbound")
          }
        } else {
          pushToast("Không lấy được vé gắn Peer Core")
          setPeerState("unbound")
        }
      })
    }

    client.onOpen = () => {
      lastPongOkAtRef.current = Date.now()
      lastProbeRef.current = null
      setPeerState((s) => (s === "on" ? s : "scanning"))
    }

    client.onHello = (h) => {
      setPeerPort(h.port || client.port)
      if (shouldReleaseHello(h, client.port, releasePortRef.current, meIdRef.current)) {
        releasePortRef.current = 0
        setOtherPeer(null)
        client.resetOtherPorts()
        setNoFreeCore(false)
        client.send({ type: "unbind" })
        setPeerState("binding")
        window.setTimeout(() => client.send({ type: "hello" }), 300)
        return
      }
      const action = decideHello(h, meIdRef.current)
      if (action === "bind") {
        setOtherPeer(null)
        requestBind(h.nonce || "")
      } else if (action === "adopt") {
        peerApiPortRef.current = h.apiPort ?? 0
        peerOnRef.current = true
        setOtherPeer(null)
        client.resetOtherPorts()
        setNoFreeCore(false)
        setPeerState("on")
        pushToast("Đã gắn Peer Core cục bộ 127.0.0.1:" + (h.port || client.port))
        onPeerReadyInternal(h.e2e)
      } else {
        client.noteOtherPort(h.port || client.port)
        setOtherPeer({ port: h.port || client.port, username: h.boundUsername || "" })
        setPeerState("other_account")
        client.skipCurrent()
      }
    }

    client.onClose = () => {
      const wasOn = peerOnRef.current
      peerOnRef.current = false
      setPeerState((s) => (s === "on" || wasOn ? "scanning" : s === "binding" ? "scanning" : s))
    }

    client.onFrame = (f) => {
      if (f.type === "bound") {
        peerOnRef.current = true
        peerApiPortRef.current = f.apiPort ?? 0
        client.resetOtherPorts()
        setNoFreeCore(false)
        setPeerState("on")
        pushToast("Đã gắn Peer Core cục bộ 127.0.0.1:" + client.port)
        onPeerReadyInternal(f.e2e)
      } else if (f.type === "bind_error") {
        if (f.error === "invalid_ticket" || f.error === "unauthorized") {
          pushToast("Phiên đăng nhập đã hết hạn — đăng nhập lại để gắn Peer Core")
          onSessionEnded()
        } else if (f.error === "other_account") {
          client.noteOtherPort(client.port)
          setOtherPeer({ port: client.port, username: f.boundUsername || "" })
          setPeerState("other_account")
          client.skipCurrent()
        } else if (f.error === "already_bound") {
          peerOnRef.current = true
          client.resetOtherPorts()
          setNoFreeCore(false)
          setPeerState("on")
          pushToast("Peer Core đã gắn tài khoản này")
          onPeerReadyInternal()
        } else {
          pushToast("Gắn Peer Core thất bại (" + (f.error || "lỗi") + ") — sẽ thử lại")
          setPeerState("unbound")
          window.setTimeout(() => client.send({ type: "hello" }), 4000)
        }
      } else if (f.type === "session_expired") {
        peerOnRef.current = false
        pushToast("Phiên Peer Core đã hết hạn — vui lòng đăng nhập lại")
        onSessionEnded()
      } else if (f.type === "unbound") {
        peerOnRef.current = false
        setPeerState("unbound")
      } else if (f.type === "unlocked") {
        setE2eState("unlocked")
        if (unlockResolverRef.current) {
          unlockResolverRef.current({ ok: true })
          unlockResolverRef.current = null
        }
        pushToast(f.created ? "Đã thiết lập mã hóa đầu-cuối E2E thành công" : "Đã mở khoá mã hoá đầu-cuối E2E")
        afterPeerReady()
      } else if (f.type === "unlock_failed") {
        setE2eState("locked")
        passphraseRef.current = null
        if (unlockResolverRef.current) {
          unlockResolverRef.current({
            ok: false,
            error: f.error,
            remainingAttempts: f.remainingAttempts,
            lockoutSeconds: f.lockoutSeconds,
          })
          unlockResolverRef.current = null
        } else {
          pushToast("Mở khoá E2E thất bại — sai mật khẩu?")
        }
      } else if (f.type === "locked") {
        setE2eState("locked")
      } else if (f.type === "key_changed") {
        pushToast("Cảnh báo: khoá E2E của bạn vừa thay đổi")
      } else if (f.type === "peer_key_changed") {
        pushToast("Cảnh báo bảo mật: khoá định danh của một liên hệ đã thay đổi — đã chặn kết nối")
      } else if (f.type === "passphrase_changed") {
        if (changePassResolverRef.current) {
          changePassResolverRef.current({ ok: !!f.ok, error: f.error })
          changePassResolverRef.current = null
        }
        if (f.ok) {
          setE2eState("unlocked")
          pushToast("Đã đổi mật khẩu E2E thành công")
          afterPeerReady()
        } else {
          pushToast("Đổi mật khẩu E2E thất bại")
        }
      } else if (f.type === "decrypt_batch_res" && f.items) {
        onDecryptBatch?.(f.items)
      } else if (f.type === "keystore_reset") {
        setE2eState("locked")
        passphraseRef.current = null
        pushToast("Đã xoá khoá E2E — mở khoá để tạo khoá mới")
      } else if (f.type === "offline_message" && f.message) {
        onOfflineMessage(f.message as PeerOfflineMsg)
      } else if (f.type === "history" && f.roomId !== undefined && f.messages) {
        onHistory(f.roomId, f.messages, f.hasMore === true)
      } else if (f.type === "file" && f.roomId !== undefined) {
        onFile(f)
      } else if (f.type === "file_state") {
        onFileState(f)
      } else if (f.type === "message" && f.message && "t" in f.message && f.message.t === "chat") {
        onChat(f.message)
      } else if (f.type === "seen" && f.roomId !== undefined) {
        onSeen(f.roomId, f.messageId, f.fromUserId)
      } else if (f.type === "typing" && f.roomId !== undefined && f.fromUserId !== meId) {
        onTyping(f.roomId, f.fromUsername || "", f.fromUserId)
      } else if (f.type === "edit" && f.roomId !== undefined && f.clientId) {
        onEdit(f.roomId, f.clientId, f.text ?? "")
      } else if (f.type === "recall" && f.roomId !== undefined && f.clientId) {
        onRecall(f.roomId, f.clientId)
      } else if (f.type === "reaction" && f.roomId !== undefined && f.clientId) {
        onReaction(f.roomId, f.clientId, f.emoji || "", !!f.remove, f.fromUsername || "", f.fromUserId)
      } else if (f.type === "presence" && f.userId !== undefined) {
        onPresence(f.userId, !!f.online)
      } else if (f.type === "friend_accepted") {
        const room = f.room as ApiRoom | undefined
        const friend = f.friend as ApiPublicUser | undefined
        onFriendAccepted(room, friend)
      } else if (f.type === "room_added") {
        const room = f.room as ApiRoom | undefined
        if (room && onRoomAdded) {
          onRoomAdded(room)
        }
      } else if (f.type === "room_updated") {
        const room = f.room as ApiRoom | undefined
        if (room && onRoomUpdated) {
          onRoomUpdated(room)
        }
      } else if (f.type === "room_removed") {
        if (typeof f.roomId === "number" && onRoomRemoved) {
          onRoomRemoved(f.roomId)
        }
      } else if (f.type === "udp_state" && f.roomId !== undefined) {
        const t = f.transport || (f.reachable ? "udp" : "tcp")
        setPeerTransport((prev) =>
          prev[f.roomId as number] === t ? prev : { ...prev, [f.roomId as number]: t },
        )
      } else if (f.type === "server_state") {
        setServerConnected(f.connected !== false)
        setServerRealtime(f.realtime !== false)
        netSignalsRef.current.realtime = f.realtime !== false
        setServerReason({
          tracker: f.tracker,
          ws: f.ws,
          attempts: f.attempts,
          lastPong: f.lastPong,
          lastError: f.lastError,
          lastErrorAt: f.lastErrorAt,
          http: f.http,
        })
      } else if (f.type === "pong") {
        const sentAt = typeof f.ts === "number" ? f.ts : pingSentAtRef.current ?? Date.now()
        const rtt = Math.max(0, Date.now() - sentAt)
        lastPongOkAtRef.current = Date.now()
        lastProbeRef.current = { ok: true, slow: rtt > NET_WEAK_PING_MS }
        applyNet()
      } else if (f.type === "send_state" && f.roomId !== undefined && f.clientId) {
        onSendState(f.roomId as number, f.clientId, f.state ?? "", f.retryable === true)
      } else if (f.type === "decrypt_failed" && f.roomId !== undefined && f.clientId) {
        onDecryptFailed(f.roomId as number, f.clientId)
      } else if (f.type === "call" && f.roomId !== undefined) {
        onCallFrame(f)
      } else if (f.type === "call_state" && f.callId) {
        onCallFrame(f)
      } else if (f.type === "error" && f.code) {
        onCallError(f.code, f.error)
      }
    }

    setPeerState("scanning")
    client.connect()

    const pingTimer = window.setInterval(() => {
      pingSentAtRef.current = Date.now()
      client.ping()
      const nowOnline =
        typeof navigator === "undefined" ? true : navigator.onLine !== false
      if (nowOnline !== netSignalsRef.current.browserOnline) {
        setBrowserOnline(nowOnline)
      }
    }, NET_PING_INTERVAL_MS)

    const pingWatchdog = window.setInterval(() => {
      const t = lastPongOkAtRef.current
      if (t != null && Date.now() - t > NET_DEAD_PING_MS) {
        if (lastProbeRef.current == null || lastProbeRef.current.ok) {
          lastProbeRef.current = { ok: false, slow: false }
          applyNet()
        }
      }
    }, 1000)

    const kick = () => {
      try {
        pingSentAtRef.current = Date.now()
        client.ping()
      } catch {}
    }
    const onOnline = () => {
      setBrowserOnline(true)
      kick()
    }
    const onOffline = () => {
      setBrowserOnline(false)
      kick()
    }
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    return () => {
      window.clearInterval(pingTimer)
      window.clearInterval(pingWatchdog)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      client.close()
      peerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId])

  const peerStatusLabel =
    peerState === "on"
      ? "mesh sẵn sàng"
      : peerState === "binding"
        ? "đang gắn…"
        : peerState === "unbound"
          ? "chưa gắn tài khoản"
          : peerState === "other_account"
            ? "gắn tài khoản khác"
            : peerState === "no_core"
              ? "chưa thấy Peer Core"
              : peerState === "scanning"
                ? "đang dò Peer Core…"
                : "chưa khởi động"

  return {
    peerPort,
    peerState,
    otherPeer,
    noFreeCore,
    peerTransport,
    e2eState,
    setE2eState,
    serverConnected,
    serverRealtime,
    serverReason,
    browserOnline,
    netState,
    peerRef,
    peerOnRef,
    passphraseRef,
    peerApiPortRef,
    peerStatusLabel,
    applyStun,
    handleReleasePeer,
    unlockWithPassphrase,
    changePassphraseWithTicket,
    lockKeystore,
    requestUnlock,
    requestChangePassphrase,
    requestResetKeystore,
    logoutWithPeerRevoke,
  }
}
