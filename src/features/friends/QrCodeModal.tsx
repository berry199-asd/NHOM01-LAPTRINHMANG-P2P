import React, { useState, useEffect, useRef } from "react"
import QRCode from "qrcode"
import { BrowserQRCodeReader } from "@zxing/browser"
import { api, type ApiPublicUser } from "../../lib/api"
import { buildUserLink, parseAnyLink } from "../../lib/link"
import { initialsOf } from "../../lib/callView"

export interface QrCodeModalProps {
  isOpen: boolean
  onClose: () => void
  onFriendRequested?: (user: ApiPublicUser) => void
  onOpenRoomDirect?: (
    userId: number,
    publicId?: string,
    displayName?: string,
  ) => void
}

export function QrCodeModal({
  isOpen,
  onClose,
  onFriendRequested,
  onOpenRoomDirect,
}: QrCodeModalProps) {
  const [tab, setTab] = useState<"mine" | "scan">("mine")

  // Tab Mã của tôi
  const [myPublicId, setMyPublicId] = useState("")
  const [myLink, setMyLink] = useState("")
  const [copied, setCopied] = useState(false)
  const [qrError, setQrError] = useState("")
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)

  // Tab Quét QR / Nhập liên kết
  const [inputVal, setInputVal] = useState("")
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState("")
  const [foundUser, setFoundUser] = useState<ApiPublicUser | null>(null)
  const [userRelation, setUserRelation] = useState<string>("none")
  const [addingFriend, setAddingFriend] = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lấy public_id của người dùng hiện tại
  useEffect(() => {
    if (!isOpen) return
    api.me().then((res) => {
      if (res.ok && res.data?.user) {
        const pid = res.data.user.public_id || res.data.user.username
        setMyPublicId(pid)
        setMyLink(buildUserLink(pid))
      } else {
        setQrError("Không thể lấy thông tin liên kết của bạn")
      }
    })
  }, [isOpen])

  // Vẽ mã QR lên canvas
  useEffect(() => {
    if (tab !== "mine" || !myLink || !qrCanvasRef.current) return
    QRCode.toCanvas(qrCanvasRef.current, myLink, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#1e293b",
        light: "#ffffff",
      },
    }).catch(() => {
      setQrError("Không thể tạo mã QR")
    })
  }, [tab, myLink])

  // Tắt camera khi chuyển tab hoặc đóng modal
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [tab, isOpen])

  // Đóng modal bằng phím Esc
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  const startCamera = async () => {
    setCameraError("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraActive(true)
        scanVideoLoop()
      }
    } catch {
      setCameraError("Không thể mở máy ảnh. Vui lòng cấp quyền truy cập máy ảnh.")
      setCameraActive(false)
    }
  }

  const scanVideoLoop = () => {
    if (!videoRef.current || !streamRef.current) return
    const reader = new BrowserQRCodeReader()
    reader
      .decodeFromVideoElement(videoRef.current)
      .then((res) => {
        if (res && res.getText()) {
          stopCamera()
          handleLookup(res.getText())
        }
      })
      .catch(() => {
        // Tiếp tục quét ở frame sau
        if (streamRef.current) {
          requestAnimationFrame(scanVideoLoop)
        }
      })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setResolving(true)
    setResolveError("")
    setFoundUser(null)
    try {
      const imgUrl = URL.createObjectURL(file)
      const reader = new BrowserQRCodeReader()
      const result = await reader.decodeFromImageUrl(imgUrl)
      URL.revokeObjectURL(imgUrl)
      if (result && result.getText()) {
        await handleLookup(result.getText())
      } else {
        setResolveError("Không tìm thấy mã QR trong ảnh")
      }
    } catch {
      setResolveError("Không thể đọc mã QR từ tệp ảnh này")
    } finally {
      setResolving(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleLookup = async (queryText?: string) => {
    const raw = (queryText !== undefined ? queryText : inputVal).trim()
    if (!raw) return
    setResolving(true)
    setResolveError("")
    setFoundUser(null)

    try {
      // 1. Thử bóc tách liên kết /u/ hoặc /r/
      const linkTarget = parseAnyLink(raw)
      const targetQuery =
        linkTarget?.type === "user" ? linkTarget.publicId : raw

      // 2. Thử tìm bằng api.searchUser
      const searchRes = await api.searchUser(targetQuery)
      if (searchRes.ok && searchRes.data?.users && searchRes.data.users.length > 0) {
        const u = searchRes.data.users[0]
        setFoundUser(u)
        setUserRelation(u.relation || "none")
        return
      }

      // 3. Fallback tra cứu bằng public ID trực tiếp
      const directId = targetQuery.replace(/^\/?[uU]\//, "").replace(/^@/, "")
      const userRes = await api.userByPublicId(directId)
      if (userRes.ok && userRes.data?.user) {
        const u = userRes.data.user
        setFoundUser(u)
        setUserRelation(u.relation || "none")
      } else {
        setResolveError(
          "Không tìm thấy người dùng với liên kết hoặc mã kết bạn này.",
        )
      }
    } catch {
      setResolveError("Đã xảy ra lỗi khi tìm kiếm. Vui lòng thử lại sau.")
    } finally {
      setResolving(false)
    }
  }

  const handleSendFriendRequest = async () => {
    if (!foundUser) return
    const pid = foundUser.public_id || foundUser.username
    if (!pid) return

    setAddingFriend(true)
    try {
      const res = await api.requestFriend(pid)
      if (res.ok) {
        if (res.data?.outcome === "accepted") {
          setUserRelation("friend")
        } else {
          setUserRelation("pending_sent")
        }
        if (onFriendRequested) onFriendRequested(foundUser)
      } else {
        if (res.error === "already_friends") {
          setUserRelation("friend")
        } else if (res.error === "already_pending") {
          setUserRelation("pending_sent")
        } else {
          setResolveError("Không thể gửi lời mời kết bạn. Vui lòng thử lại.")
        }
      }
    } catch {
      setResolveError("Đã xảy ra lỗi khi gửi lời mời")
    } finally {
      setAddingFriend(false)
    }
  }

  const copyLink = () => {
    if (!myLink) return
    navigator.clipboard.writeText(myLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const downloadQr = () => {
    if (!qrCanvasRef.current) return
    const a = document.createElement("a")
    a.download = `workchat-qr-${myPublicId || "user"}.png`
    a.href = qrCanvasRef.current.toDataURL("image/png")
    a.click()
  }

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 id="qr-modal-title" className="text-base font-bold">
            Mã QR & Liên kết kết bạn
          </h2>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            style={{ color: "var(--muted)" }}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab switcher */}
        <div
          className="flex px-6 pt-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <button
            onClick={() => {
              setTab("mine")
              stopCamera()
            }}
            className={`flex-1 py-2.5 text-sm font-semibold text-center border-b-2 transition-all ${
              tab === "mine"
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            Mã QR của tôi
          </button>
          <button
            onClick={() => setTab("scan")}
            className={`flex-1 py-2.5 text-sm font-semibold text-center border-b-2 transition-all ${
              tab === "scan"
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            Quét mã / Nhập liên kết
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6 overflow-y-auto max-h-[75vh]">
          {tab === "mine" ? (
            <div className="flex flex-col items-center text-center">
              <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                Quét mã này hoặc gửi liên kết bên dưới để kết bạn nhanh trên
                WorkChat
              </p>

              {/* QR Container */}
              <div
                className="p-4 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-4"
                style={{ border: "1px solid var(--border)" }}
              >
                <canvas ref={qrCanvasRef} className="rounded-lg" />
              </div>

              {qrError && (
                <p className="text-xs text-red-500 mb-3">{qrError}</p>
              )}

              {/* Link Input & Copy */}
              <div className="w-full mb-4">
                <div
                  className="flex items-center rounded-xl overflow-hidden pl-3 pr-1.5 py-1.5"
                  style={{
                    backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <input
                    type="text"
                    readOnly
                    value={myLink}
                    aria-label="Liên kết kết bạn của bạn"
                    className="flex-1 text-xs bg-transparent outline-none truncate mr-2"
                    style={{ color: "var(--text)" }}
                  />
                  <button
                    onClick={copyLink}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all"
                    style={{
                      backgroundColor: copied
                        ? "#22c55e"
                        : "var(--primary)",
                      color: "#ffffff",
                    }}
                  >
                    {copied ? (
                      <>
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Đã chép
                      </>
                    ) : (
                      <>
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
                          <rect
                            x="9"
                            y="9"
                            width="13"
                            height="13"
                            rx="2"
                            ry="2"
                          />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Sao chép
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Download QR button */}
              <button
                onClick={downloadQr}
                className="w-full py-2.5 text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors hover:opacity-90"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
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
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Tải ảnh mã QR về máy
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Dán địa chỉ liên kết /u/..., mã kết bạn hoặc tải ảnh QR để kết
                bạn nhanh
              </p>

              {/* Input liên kết / mã */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => {
                    setInputVal(e.target.value)
                    setResolveError("")
                    setFoundUser(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLookup()
                  }}
                  placeholder="Dán liên kết /u/... hoặc mã bạn bè..."
                  className="flex-1 px-3 py-2 text-xs rounded-xl outline-none"
                  style={{
                    backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                />
                <button
                  onClick={() => handleLookup()}
                  disabled={resolving || !inputVal.trim()}
                  className="px-4 py-2 text-xs font-semibold rounded-xl transition-all disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  {resolving ? "Đang tìm..." : "Tìm"}
                </button>
              </div>

              {/* Action buttons: Camera + File Upload */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={cameraActive ? stopCamera : startCamera}
                  className="py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: cameraActive
                      ? "var(--error)"
                      : "var(--surface)",
                    border: "1px solid var(--border)",
                    color: cameraActive ? "#ffffff" : "var(--text)",
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
                  >
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  {cameraActive ? "Tắt máy ảnh" : "Mở máy ảnh"}
                </button>

                <label
                  className="py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
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
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  Tải ảnh mã QR
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Camera view container */}
              {cameraActive && (
                <div
                  className="relative w-full rounded-2xl overflow-hidden aspect-video flex items-center justify-center bg-black"
                  style={{ border: "2px solid var(--primary)" }}
                >
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                  />
                  <div className="absolute inset-0 border-2 border-white/60 m-8 rounded-xl pointer-events-none" />
                  <p className="absolute bottom-2 text-[11px] text-white/80 bg-black/50 px-2 py-0.5 rounded">
                    Hướng máy ảnh vào mã QR để quét
                  </p>
                </div>
              )}

              {cameraError && (
                <p className="text-xs text-red-500 text-center">{cameraError}</p>
              )}

              {resolveError && (
                <p className="text-xs text-red-500 text-center py-1">
                  {resolveError}
                </p>
              )}

              {/* Kết quả tìm kiếm người dùng */}
              {foundUser && (
                <div
                  className="p-3.5 rounded-xl flex items-center gap-3 animate-in fade-in"
                  style={{
                    backgroundColor: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center text-sm font-bold select-none"
                    style={{
                      backgroundColor: "var(--primary)",
                      color: "var(--primary-fg)",
                    }}
                  >
                    {foundUser.avatar ? (
                      <img
                        src={foundUser.avatar}
                        alt={foundUser.display_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      initialsOf(
                        foundUser.display_name ||
                          foundUser.username ||
                          "?",
                      )
                    )}
                  </div>

                  {/* Thông tin */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-bold truncate"
                      style={{ color: "var(--text)" }}
                    >
                      {foundUser.display_name || foundUser.username}
                    </p>
                    <p
                      className="text-xs truncate"
                      style={{ color: "var(--muted)" }}
                    >
                      @{foundUser.username}
                    </p>
                  </div>

                  {/* Nút hành động */}
                  <div className="flex-shrink-0">
                    {userRelation === "none" && (
                      <button
                        onClick={handleSendFriendRequest}
                        disabled={addingFriend}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        {addingFriend ? "Đang gửi..." : "Kết bạn"}
                      </button>
                    )}

                    {userRelation === "pending_sent" && (
                      <span
                        className="px-2.5 py-1 text-xs font-medium rounded-lg"
                        style={{
                          backgroundColor: "var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        Đã gửi lời mời
                      </span>
                    )}

                    {userRelation === "pending_received" && (
                      <button
                        onClick={() => {
                          if (foundUser.request_id) {
                            api.acceptFriend(foundUser.request_id).then((r) => {
                              if (r.ok) setUserRelation("friend")
                            })
                          }
                        }}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white"
                      >
                        Chấp nhận
                      </button>
                    )}

                    {userRelation === "friend" && (
                      <button
                        onClick={() => {
                          onClose()
                          if (onOpenRoomDirect && foundUser.id) {
                            onOpenRoomDirect(
                              foundUser.id,
                              foundUser.public_id,
                              foundUser.display_name,
                            )
                          }
                        }}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded-lg"
                        style={{
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-fg)",
                        }}
                      >
                        Nhắn tin
                      </button>
                    )}

                    {userRelation === "self" && (
                      <span
                        className="px-2.5 py-1 text-xs font-medium rounded-lg"
                        style={{
                          backgroundColor: "var(--border)",
                          color: "var(--muted)",
                        }}
                      >
                        Chính bạn
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
