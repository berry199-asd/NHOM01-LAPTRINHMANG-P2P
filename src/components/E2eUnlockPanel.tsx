import React, { useState, useRef, useEffect } from "react"

export interface E2eUnlockPanelProps {
  onUnlock: (passphrase: string) => Promise<{
    ok: boolean
    error?: string
    remainingAttempts?: number
    lockoutSeconds?: number
  }>
  onOpenResetPassphrase?: () => void
  onResetKeystore?: () => void
  isLocked: boolean
  isNewKeystore?: boolean
}

export function E2eUnlockPanel({
  onUnlock,
  onOpenResetPassphrase,
  onResetKeystore,
  isLocked,
  isNewKeystore = false,
}: E2eUnlockPanelProps) {
  const [digits, setDigits] = useState<string[]>(Array(8).fill(""))
  const [showMask, setShowMask] = useState(true)
  const [isLongPass, setIsLongPass] = useState(false)
  const [longPass, setLongPass] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [lockoutSec, setLockoutSec] = useState<number>(0)
  const [collapsed, setCollapsed] = useState(!isLocked)

  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isLocked) {
      setCollapsed(true)
    } else {
      setCollapsed(false)
    }
  }, [isLocked])

  // Đếm ngược khóa tạm nếu bị giới hạn brute-force
  useEffect(() => {
    if (lockoutSec > 0) {
      timerRef.current = setInterval(() => {
        setLockoutSec((s) => {
          if (s <= 1) {
            clearInterval(timerRef.current!)
            return 0
          }
          return s - 1
        })
      }, 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [lockoutSec])

  const triggerShake = () => {
    setShake(true)
    setTimeout(() => setShake(false), 500)
  }

  const handleSubmit = async (passcode: string) => {
    if (loading || lockoutSec > 0) return
    const trimmed = (passcode || "").trim()
    if (!trimmed) {
      setErrorMsg("Vui lòng nhập mã mở khóa")
      triggerShake()
      return
    }
    setLoading(true)
    setErrorMsg(null)

    try {
      const res = await onUnlock(passcode)
      if (res.ok) {
        setCollapsed(true)
        setDigits(Array(8).fill(""))
        setLongPass("")
      } else {
        triggerShake()
        if (res.lockoutSeconds && res.lockoutSeconds > 0) {
          setLockoutSec(res.lockoutSeconds)
          setErrorMsg(`Bạn đã nhập sai nhiều lần. Vui lòng thử lại sau ${res.lockoutSeconds}s.`)
        } else if (res.remainingAttempts !== undefined) {
          setErrorMsg(`Mã mở khóa không đúng. Còn lại ${res.remainingAttempts} lần thử.`)
        } else {
          setErrorMsg(res.error || "Mã mở khóa không đúng. Vui lòng thử lại.")
        }
        if (!isLongPass) {
          setDigits(Array(8).fill(""))
          inputRefs.current[0]?.focus()
        }
      }
    } catch {
      triggerShake()
      setErrorMsg("Lỗi kết nối khi mở khóa E2E")
    } finally {
      setLoading(false)
    }
  }

  const handleDigitChange = (index: number, val: string) => {
    if (lockoutSec > 0) return
    const char = val.slice(-1) // lấy ký tự cuối nếu người dùng gõ
    const nextDigits = [...digits]
    nextDigits[index] = char
    setDigits(nextDigits)
    setErrorMsg(null)

    if (char && index < 7) {
      inputRefs.current[index + 1]?.focus()
    }

    // Nếu đã điền đủ 8 ký tự, tự động submit
    if (char && index === 7 && nextDigits.every((d) => d.length > 0)) {
      void handleSubmit(nextDigits.join(""))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        const nextDigits = [...digits]
        nextDigits[index - 1] = ""
        setDigits(nextDigits)
        inputRefs.current[index - 1]?.focus()
      } else {
        const nextDigits = [...digits]
        nextDigits[index] = ""
        setDigits(nextDigits)
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === "ArrowRight" && index < 7) {
      inputRefs.current[index + 1]?.focus()
    } else if (e.key === "Enter") {
      void handleSubmit(digits.join(""))
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (lockoutSec > 0) return
    const text = e.clipboardData.getData("text").trim()
    if (!text) return
    if (text.length > 8) {
      // Tự chuyển sang chế độ mật khẩu dài
      setIsLongPass(true)
      setLongPass(text)
      return
    }
    const chars = text.split("").slice(0, 8)
    const nextDigits = [...digits]
    for (let i = 0; i < 8; i++) {
      nextDigits[i] = chars[i] || ""
    }
    setDigits(nextDigits)
    setErrorMsg(null)
    const nextFocus = Math.min(chars.length, 7)
    inputRefs.current[nextFocus]?.focus()
    if (chars.length === 8) {
      void handleSubmit(text)
    }
  }

  if (collapsed) {
    return null
  }

  return (
    <div
      className={`mx-3 mb-3 p-3.5 rounded-xl text-xs transition-all duration-250 ease-out ${
        shake ? "animate-[shake_0.5s_ease-in-out]" : ""
      }`}
      style={{
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-5px); }
          40%, 80% { transform: translateX(5px); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 font-medium" style={{ color: "var(--text)" }}>
          {isNewKeystore ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-500"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          )}
          <span>{isNewKeystore ? "Thiết lập mã khóa E2E" : "Mở khóa tin nhắn E2E"}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowMask(!showMask)}
          className="text-xs opacity-70 hover:opacity-100 transition-opacity p-0.5"
          style={{ color: "var(--muted)" }}
          title={showMask ? "Hiện mã" : "Ẩn mã"}
          aria-label={showMask ? "Hiện mã" : "Ẩn mã"}
        >
          {showMask ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
        </button>
      </div>

      {isNewKeystore && (
        <p className="text-[11px] mb-2 leading-relaxed" style={{ color: "var(--muted)" }}>
          Tài khoản chưa có kho khóa E2E trên máy này. Hãy tạo một mã gồm 8 ký tự để bảo vệ tin nhắn của bạn.
        </p>
      )}

      {/* Input boxes */}
      {!isLongPass ? (
        <div className="flex items-center justify-between gap-1 mb-2.5">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el
              }}
              type={showMask ? "password" : "text"}
              maxLength={1}
              value={digit}
              disabled={loading || lockoutSec > 0}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              autoFocus={i === 0}
              aria-label={`Ký tự ${i + 1}`}
              className="w-7 h-9 text-center text-sm font-semibold rounded-md outline-none transition-all focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
              style={{
                backgroundColor: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            />
          ))}
        </div>
      ) : (
        <div className="mb-2.5">
          <input
            type={showMask ? "password" : "text"}
            value={longPass}
            onChange={(e) => {
              setLongPass(e.target.value)
              setErrorMsg(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit(longPass)
            }}
            placeholder="Nhập mật khẩu E2E dài..."
            disabled={loading || lockoutSec > 0}
            className="w-full px-2.5 py-1.5 text-xs rounded-md outline-none transition-all focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            autoFocus
          />
        </div>
      )}

      {/* Error / Lockout Message */}
      {errorMsg && (
        <p className="text-[11px] mb-2 leading-tight" style={{ color: "var(--error, #ef4444)" }}>
          {errorMsg}
        </p>
      )}

      {/* Action / Toggle links */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <button
          type="button"
          onClick={() => {
            setIsLongPass(!isLongPass)
            setErrorMsg(null)
          }}
          className="text-[11px] underline opacity-80 hover:opacity-100 transition-opacity"
          style={{ color: "var(--muted)" }}
        >
          {isLongPass ? "← Dùng ô nhập 8 ký tự" : "Mã dài hơn? Nhập mật khẩu"}
        </button>

        <button
          type="button"
          disabled={loading || lockoutSec > 0}
          onClick={() => handleSubmit(isLongPass ? longPass : digits.join(""))}
          className="px-3 py-1 rounded-md font-medium transition-opacity disabled:opacity-50 text-white"
          style={{
            backgroundColor: isNewKeystore ? "var(--accent, #10b981)" : "var(--primary)",
          }}
        >
          {loading ? (isNewKeystore ? "Đang tạo…" : "Đang mở…") : lockoutSec > 0 ? `${lockoutSec}s` : isNewKeystore ? "Tạo mã E2E" : "Mở khóa"}
        </button>
      </div>

      {!isNewKeystore && (
        <div className="mt-2 pt-2 border-t flex items-center justify-between gap-2" style={{ borderColor: "var(--border)" }}>
          {onResetKeystore && (
            <button
              type="button"
              onClick={onResetKeystore}
              className="text-[11px] text-red-500 opacity-80 hover:opacity-100 hover:underline transition-opacity cursor-pointer"
              title="Xoá khoá cũ trên máy này để tạo mã mới từ đầu"
            >
              Làm lại từ đầu
            </button>
          )}
          {onOpenResetPassphrase && (
            <button
              type="button"
              onClick={onOpenResetPassphrase}
              className="text-[11px] opacity-70 hover:opacity-100 hover:underline transition-opacity ml-auto cursor-pointer"
              style={{ color: "var(--muted)" }}
            >
              Quên mã? Đổi bằng Email + OTP
            </button>
          )}
        </div>
      )}
    </div>
  )
}
