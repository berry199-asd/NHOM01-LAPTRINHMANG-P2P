import { useEffect, useRef, useState } from "react"
import { BrowserQRCodeReader } from "@zxing/browser"
import QRCode from "qrcode"
import {
  api,
  type ApiFriendRequestItem,
  type ApiPublicUser,
  type ApiRoom,
  type Relation,
} from "../lib/api"
import { buildUserLink, parseAnyLink, type InviteTarget } from "../lib/link"
import { RelationActions, friendActionError } from "./RelationActions"
import { Avatar } from "./Avatar"

type Tab = "search" | "scan" | "mine" | "requests"

type ResultState =
  | { kind: "user"; user: ApiPublicUser }
  | { kind: "room"; room: ApiRoom }
  | { kind: "error"; message: string }

interface Props {
  onClose: () => void
  onJoinRoom?: (room: ApiRoom) => void
  onViewUser?: (u: {
    publicId?: string
    name: string
    initials: string
    avatar?: string
    relation?: Relation
    requestId?: number
  }) => void
  initialTarget?: InviteTarget | null
  onConsumedInvite?: () => void
  onFriendAccepted?: () => void
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return (first + last).toUpperCase() || "??"
}

export function FindFriendsModal({
  onClose,
  onJoinRoom,
  onFriendAccepted,
  onViewUser,
  initialTarget,
  onConsumedInvite,
}: Props) {
  const [tab, setTab] = useState<Tab>("search")
  const [query, setQuery] = useState("")
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchUser, setSearchUser] = useState<ApiPublicUser | null>(null)
  const [searchError, setSearchError] = useState("")

  const [linkInput, setLinkInput] = useState("")
  const [resolving, setResolving] = useState(false)
  const [result, setResult] = useState<ResultState | null>(null)

  const [scanMode, setScanMode] = useState<"idle" | "video">("idle")
  const [scanMsg, setScanMsg] = useState("")
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [requests, setRequests] = useState<ApiFriendRequestItem[] | null>(null)
  const [requestsBusy, setRequestsBusy] = useState(false)

  const [myPublicId, setMyPublicId] = useState("")
  const [myLink, setMyLink] = useState("")
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const [qrError, setQrError] = useState("")

  // dọn camera khi đóng modal
  useEffect(() => {
    return () => {
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // resolve initialTarget (link /u/... hoặc /r/... từ URL)
  useEffect(() => {
    if (!initialTarget) return
    setTab("scan")
    resolveTarget(initialTarget, "link")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTarget])

  // mã QR của tôi
  useEffect(() => {
    if (tab !== "mine") return
    if (!myPublicId) {
      api.me().then((r) => {
        const pid = r.ok && r.data?.user?.public_id
        if (pid) {
          setMyPublicId(pid)
          setMyLink(buildUserLink(pid))
        } else {
          setQrError("Không lấy được mã của bạn")
        }
      })
    }
  }, [tab, myPublicId])

  useEffect(() => {
    if (tab !== "mine" || !myLink || !qrRef.current) return
    QRCode.toCanvas(qrRef.current, myLink, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1a1a1a", light: "#ffffff" },
    }).catch(() => setQrError("Không tạo được mã QR"))
  }, [tab, myLink])

  // lời mời kết bạn
  useEffect(() => {
    if (tab !== "requests") return
    loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const loadRequests = async () => {
    setRequestsBusy(true)
    const r = await api.friendRequests()
    setRequestsBusy(false)
    setRequests(r.ok && r.data ? r.data.requests : [])
  }

  const resolveTarget = async (target: InviteTarget, source: "link" | "qr") => {
    setResolving(true)
    try {
      if (target.type === "user") {
        const r = await api.userByPublicId(target.publicId)
        if (!r.ok || !r.data?.user) {
          setResult({
            kind: "error",
            message:
              r.status === 404
                ? "Không tìm thấy tài khoản với mã này"
                : "Lỗi tra cứu, thử lại sau",
          })
        } else {
          setResult({
            kind: "user",
            user: { ...r.data.user, public_id: target.publicId },
          })
        }
      } else {
        const r = await api.joinRoom(target.code)
        if (!r.ok || !r.data) {
          const message =
            r.error === "invite_expired"
              ? "Mã mời đã hết hạn"
              : r.error === "room_full"
                ? "Phòng đã đầy"
                : "Mã mời không hợp lệ"
          setResult({ kind: "error", message })
        } else {
          setResult({ kind: "room", room: r.data.room })
          onJoinRoom?.(r.data.room)
        }
      }
    } finally {
      setResolving(false)
      if (source === "qr") setScanMsg("")
      onConsumedInvite?.()
    }
  }

  const handleLinkSubmit = () => {
    const target = parseAnyLink(linkInput)
    if (!target) {
      setResult({
        kind: "error",
        message: "Không nhận dạng được liên kết. Cần dạng /u/<mã> hoặc /r/<mã>.",
      })
      return
    }
    resolveTarget(target, "link")
  }

  // LUỒNG 2c: chỉ tra đúng theo mã người dùng (public ID) / liên kết /u/<mã>,
  // KHÔNG liệt kê hay tìm mờ toàn bộ người dùng.
  const handleSearch = async () => {
    const raw = query.trim()
    if (!raw) return
    setSearchBusy(true)
    setSearchError("")
    try {
      const res = await api.searchUser(raw)
      if (res.ok && res.data?.users && res.data.users.length > 0) {
        setSearchUser(res.data.users[0])
      } else {
        const target = parseAnyLink(raw)
        const publicId = target?.type === "user" ? target.publicId : raw
        const r = await api.userByPublicId(publicId)
        if (r.ok && r.data?.user) {
          setSearchUser({ ...r.data.user, public_id: publicId })
        } else {
          setSearchUser(null)
          setSearchError("Không tìm thấy người dùng với thông tin này.")
        }
      }
    } catch {
      setSearchUser(null)
      setSearchError("Đã xảy ra lỗi khi tìm kiếm")
    } finally {
      setSearchBusy(false)
    }
  }

  const showFriendError = (error?: string) => {
    setSearchError(friendActionError(error))
    setResult({ kind: "error", message: friendActionError(error) })
  }

  const refreshRequests = () => {
    if (requests !== null) loadRequests()
  }

  const onRelationChange =
    (apply: (rel: Relation, requestId?: number) => void) =>
    (rel: Relation, requestId?: number) => {
      apply(rel, requestId)
      refreshRequests()
      if (rel === "friend") onFriendAccepted?.()
    }

  const handleScanText = async (text: string) => {
    const target = parseAnyLink(text)
    if (!target) {
      setScanMsg("Không đọc được mã QR")
      return
    }
    await resolveTarget(target, "qr")
  }

  const onFileSelected = async (f: File | null) => {
    if (!f) return
    setScanMsg("Đang giải mã ảnh…")
    const url = URL.createObjectURL(f)
    try {
      const reader = new BrowserQRCodeReader()
      const result = await reader.decodeFromImageUrl(url)
      const text = result?.getText()
      if (!text) {
        setScanMsg("Không tìm thấy mã QR trong ảnh")
      } else {
        await handleScanText(text)
      }
    } catch {
      setScanMsg("Không đọc được mã QR trong ảnh")
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const startCamera = async () => {
    setScanMsg("Đang mở camera…")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setScanMode("video")
      const reader = new BrowserQRCodeReader()
      const result = await reader.decodeOnceFromVideoDevice(
        undefined,
        videoRef.current ?? undefined,
      )
      const text = result?.getText()
      stopCamera()
      if (text) await handleScanText(text)
    } catch (e) {
      setScanMode("idle")
      setScanMsg("Không mở được camera (cần HTTPS hoặc quyền camera)")
    }
  }

  const stopCamera = () => {
    setScanMode("idle")
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const acceptRequest = async (id: number) => {
    setRequestsBusy(true)
    const r = await api.acceptFriend(id)
    setRequestsBusy(false)
    if (r.ok) onFriendAccepted?.()
    loadRequests()
  }

  const rejectRequest = async (id: number) => {
    setRequestsBusy(true)
    await api.rejectFriend(id)
    setRequestsBusy(false)
    loadRequests()
  }

  const downloadQR = () => {
    if (!qrRef.current) return
    const a = document.createElement("a")
    a.download = "qrcode-ket-ban.png"
    a.href = qrRef.current.toDataURL("image/png")
    a.click()
  }

  const copyMyLink = () => {
    navigator.clipboard.writeText(myLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const tabStyle = (active: boolean) => ({
    paddingBottom: "10px",
    borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    transition: "all 0.15s",
  })

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    fontSize: "14px",
    borderRadius: "8px",
    outline: "none",
  } as const

  const renderUserRow = (
    user: ApiPublicUser,
    onRowView?: () => void,
    onChanged?: (u: ApiPublicUser) => void,
  ) => {
    return (
      <div
        className="flex items-center gap-3 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <button
          onClick={onRowView}
          className="flex items-center gap-3 flex-1 min-w-0 text-left rounded"
        >
          <Avatar name={user.display_name} src={user.avatar || undefined} />
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-medium truncate"
              style={{ color: "var(--text)" }}
            >
              {user.display_name}
            </p>
          </div>
        </button>
        <RelationActions
          relation={user.relation ?? "none"}
          publicId={user.public_id}
          requestId={user.request_id}
          onError={showFriendError}
          onChange={onRelationChange((rel, requestId) => {
            const next = {
              ...user,
              relation: rel,
              request_id: requestId ?? user.request_id,
            }
            if (onChanged) onChanged(next)
            else setResult({ kind: "user", user: next })
          })}
        />
      </div>
    )
  }

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
          maxHeight: "84vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            Tìm bạn & kết nối
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-5 px-6 flex-shrink-0 overflow-x-auto"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {(
            [
              ["search", "Tìm bạn"],
              ["scan", "Quét QR"],
              ["mine", "Mã QR của tôi"],
              ["requests", "Lời mời"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              style={tabStyle(tab === id)}
              className="text-sm pb-0 whitespace-nowrap"
              onClick={() => setTab(id)}
            >
              {label}
              {id === "requests" && requests && requests.length > 0 && (
                <span
                  className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full"
                  style={{ backgroundColor: "var(--primary)", color: "var(--primary-fg)" }}
                >
                  {requests.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "search" && (
            <div className="px-6 py-4">
              <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                Tìm theo tên hiển thị, @username, email, mã người dùng hoặc liên kết /u/&lt;mã&gt;.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setSearchUser(null)
                    setSearchError("")
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch()
                  }}
                  placeholder="Nhập tên, @username, email hoặc mã..."
                  className="flex-1 px-3 py-2.5 text-sm rounded-md outline-none"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                  autoFocus
                />
                <button
                  onClick={handleSearch}
                  disabled={!query.trim() || searchBusy}
                  className="px-4 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                    opacity: !query.trim() || searchBusy ? 0.4 : 1,
                  }}
                >
                  Tìm
                </button>
              </div>
              <div className="mt-3">
                {searchBusy ? (
                  <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>
                    Đang tìm…
                  </p>
                ) : searchUser ? (
                  renderUserRow(
                    searchUser,
                    () =>
                      onViewUser?.({
                        publicId: searchUser.public_id,
                        name: searchUser.display_name,
                        initials: initialsOf(searchUser.display_name),
                        avatar: searchUser.avatar,
                        relation: searchUser.relation,
                        requestId: searchUser.request_id,
                      }),
                    setSearchUser,
                  )
                ) : searchError ? (
                  <p className="text-sm text-center py-8" style={{ color: "var(--error)" }}>
                    {searchError}
                  </p>
                ) : (
                  <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>
                    Nhập đúng mã người dùng để tìm.
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === "scan" && (
            <div className="px-6 py-5 flex flex-col gap-5">
              <div className="flex gap-2 items-center">
                <button
                  onClick={startCamera}
                  disabled={scanMode === "video" || resolving}
                  className="px-4 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 flex-shrink-0"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  {scanMode === "video" ? "Đang quét…" : "Quét camera"}
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={resolving}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    backgroundColor: "var(--bg)",
                  }}
                >
                  Mở ảnh mã QR
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
                />
              </div>

              {scanMode === "video" && (
                <div>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full rounded-lg aspect-square object-cover"
                    style={{ backgroundColor: "#000", border: "1px solid var(--border)" }}
                  />
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      Hướng camera vào mã QR
                    </span>
                    <button
                      onClick={stopCamera}
                      className="px-3 py-1 text-xs font-medium rounded-md"
                      style={{
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      Dừng quét
                    </button>
                  </div>
                </div>
              )}

              {scanMsg && (
                <p className="text-sm text-center" style={{ color: "var(--primary)" }}>
                  {scanMsg}
                </p>
              )}

              <div>
                <p className="text-sm font-medium mb-2" style={{ color: "var(--text)" }}>
                  Hoặc dán liên kết mời
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={linkInput}
                    onChange={(e) => {
                      setLinkInput(e.target.value)
                      setResult(null)
                    }}
                    placeholder="…/u/mãBạn hoặc …/r/mãPhòng"
                    className="flex-1 px-3 py-2 text-sm rounded-md outline-none"
                    style={{
                      backgroundColor: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                  />
                  <button
                    onClick={handleLinkSubmit}
                    disabled={!linkInput.trim() || resolving}
                    className="px-4 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-fg)",
                      opacity: !linkInput.trim() ? 0.4 : 1,
                    }}
                  >
                    Tìm
                  </button>
                </div>
              </div>

              {result &&
                result.kind === "user" &&
                renderUserRow(
                  result.user,
                  () =>
                    onViewUser?.({
                      publicId: result.user.public_id,
                      name: result.user.display_name,
                      initials: initialsOf(result.user.display_name),
                      avatar: result.user.avatar,
                      relation: result.user.relation,
                      requestId: result.user.request_id,
                    }),
                  (u) => setResult({ kind: "user", user: u }),
                )}
              {result && result.kind === "error" && (
                <p className="text-sm text-center py-2" style={{ color: "var(--error)" }}>
                  {result.message}
                </p>
              )}
              {result && result.kind === "room" && (
                <div className="flex items-center gap-3 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <Avatar name={result.room.name} src={result.room.avatar || undefined} online={false} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                      {result.room.name}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                      {result.room.members.length} thành viên · Đã tham gia
                    </p>
                  </div>
                  <span
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md"
                    style={{
                      backgroundColor: "#22c55e",
                      color: "#fff",
                    }}
                  >
                    Đã tham gia
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === "mine" && (
            <div className="px-6 py-5 flex flex-col gap-4 items-center">
              {myLink ? (
                <>
                  <canvas
                    ref={qrRef}
                    width={200}
                    height={200}
                    className="rounded-lg"
                    style={{ border: "1px solid var(--border)" }}
                  />
                  <p className="text-xs text-center font-mono break-all" style={{ color: "var(--muted)" }}>
                    {myLink}
                  </p>
                  <div className="flex gap-2 w-full">
                    <button
                      onClick={downloadQR}
                      className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                      style={{ border: "1px solid var(--border)", color: "var(--text)", backgroundColor: "var(--bg)" }}
                    >
                      Tải mã QR
                    </button>
                    <button
                      onClick={copyMyLink}
                      className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                      style={{ border: "1px solid var(--border)", color: copied ? "#22c55e" : "var(--text)", backgroundColor: "var(--bg)" }}
                    >
                      {copied ? "Đã sao chép" : "Sao chép liên kết"}
                    </button>
                  </div>
                  <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
                    Người khác quét mã này để nhìn thấy tài khoản và gửi kết bạn.
                  </p>
                </>
              ) : (
                <p className="text-sm py-8" style={{ color: qrError ? "var(--error)" : "var(--muted)" }}>
                  {qrError || "Đang tạo mã QR…"}
                </p>
              )}
            </div>
          )}

          {tab === "requests" && (
            <div className="px-6 py-4">
              {requestsBusy && requests === null ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>
                  Đang tải…
                </p>
              ) : !requests || requests.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--muted)" }}>
                  Không có lời mời nào.
                </p>
              ) : (
                <div>
                  {requests.map((r) => (
                    <div
                      key={r.request_id}
                      className="flex items-center gap-3 py-3"
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <div className="flex-1 min-w-0 flex items-center gap-3">
                        <Avatar name={r.from.display_name} src={r.from.avatar || undefined} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                            {r.from.display_name}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => acceptRequest(r.request_id)}
                        disabled={requestsBusy}
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md transition-opacity hover:opacity-80"
                        style={{ backgroundColor: "var(--primary)", color: "var(--primary-fg)" }}
                      >
                        Chấp nhận
                      </button>
                      <button
                        onClick={() => rejectRequest(r.request_id)}
                        disabled={requestsBusy}
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-opacity hover:opacity-70"
                        style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
                      >
                        Từ chối
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}