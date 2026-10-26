import React, { useState, useRef, useEffect } from "react"
import { api } from "../lib/api"

export interface E2eChangePassModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  isUnlocked: boolean
  onApplyNewPassphrase: (ticket: string, newPass: string) => Promise<{ ok: boolean; error?: string }>
  userEmail?: string
}

export function E2eChangePassModal({
  isOpen,
  onClose,
  onSuccess,
  isUnlocked,
  onApplyNewPassphrase,
  userEmail,
}: E2eChangePassModalProps) {
  const [step, setStep] = useState<"email" | "otp" | "new_pass">("email")
  const [email, setEmail] = useState(userEmail ?? "")
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(6).fill(""))
  const [ticket, setTicket] = useState("")
  const [newPass, setNewPass] = useState("")
  const [confirmPass, setConfirmPass] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const otpRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (isOpen) {
      setStep("email")
      setEmail(userEmail ?? "")
      setOtpDigits(Array(6).fill(""))
      setTicket("")
      setNewPass("")
      setConfirmPass("")
      setErrorMsg(null)
      setSuccessMsg(null)
      setLoading(false)
    }
  }, [isOpen, userEmail])

  if (!isOpen) return null

  // Bước 1: Yêu cầu OTP qua email
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    const targetEmail = email.trim() || (userEmail ?? "")
    if (loading || !targetEmail) return
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await api.e2eOtpRequest(targetEmail)
      if (res.ok && res.data?.ok) {
        setStep("otp")
      } else {
        setErrorMsg(res.error || res.data?.error || "Không thể gửi yêu cầu xác thực OTP")
      }
    } catch {
      setErrorMsg("Không thể gửi yêu cầu xác thực OTP")
    } finally {
      setLoading(false)
    }
  }

  // Bước 2: Xác thực OTP để lấy vé reset
  const handleVerifyOtp = async (code: string) => {
    const targetEmail = email.trim() || (userEmail ?? "")
    if (loading || !code) return
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await api.e2eOtpVerify(targetEmail, code.trim())
      if (res.ok && res.data?.ticket) {
        setTicket(res.data.ticket)
        setStep("new_pass")
      } else {
        setErrorMsg(res.error || res.data?.error || "Mã OTP không hợp lệ hoặc đã hết hạn")
        setOtpDigits(Array(6).fill(""))
        otpRefs.current[0]?.focus()
      }
    } catch {
      setErrorMsg("Lỗi xác minh mã OTP")
    } finally {
      setLoading(false)
    }
  }

  const handleOtpChange = (index: number, val: string) => {
    const char = val.slice(-1)
    const next = [...otpDigits]
    next[index] = char
    setOtpDigits(next)
    setErrorMsg(null)

    if (char && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
    if (char && index === 5 && next.every((d) => d.length > 0)) {
      void handleVerifyOtp(next.join(""))
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!otpDigits[index] && index > 0) {
        const next = [...otpDigits]
        next[index - 1] = ""
        setOtpDigits(next)
        otpRefs.current[index - 1]?.focus()
      } else {
        const next = [...otpDigits]
        next[index] = ""
        setOtpDigits(next)
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpRefs.current[index - 1]?.focus()
    } else if (e.key === "ArrowRight" && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData("text").trim()
    if (!text) return
    const chars = text.split("").slice(0, 6)
    const next = [...otpDigits]
    for (let i = 0; i < 6; i++) next[i] = chars[i] || ""
    setOtpDigits(next)
    setErrorMsg(null)
    if (chars.length === 6) {
      void handleVerifyOtp(chars.join(""))
    }
  }

  // Bước 3: Đặt mã mở khóa E2E mới
  const handleSubmitNewPass = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    if (!newPass || newPass.length < 6) {
      setErrorMsg("Mã E2E mới phải có ít nhất 6 ký tự")
      return
    }
    if (newPass !== confirmPass) {
      setErrorMsg("Xác nhận mã không khớp")
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const res = await onApplyNewPassphrase(ticket, newPass)
      if (res.ok) {
        setSuccessMsg("Đã đổi mã mở khóa E2E thành công!")
        setTimeout(() => {
          onSuccess()
          onClose()
        }, 1200)
      } else {
        setErrorMsg(res.error || "Đổi mã E2E thất bại")
      }
    } catch {
      setErrorMsg("Lỗi khi áp dụng mã E2E mới")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-xl text-xs"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
          color: "var(--text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className="text-amber-500">🔒</span>
            Đổi mã mở khóa E2E
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
            style={{ backgroundColor: "var(--surface)" }}
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-[11px]">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mb-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[11px]">
            {successMsg}
          </div>
        )}

        {step === "email" && (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed opacity-80" style={{ color: "var(--muted)" }}>
              Để bảo mật, vui lòng xác nhận địa chỉ email của tài khoản đang đăng nhập. Hệ thống sẽ gửi mã xác thực
              OTP 6 chữ số đến email của bạn.
            </p>
            {userEmail && (
              <div
                className="p-2.5 rounded-lg text-xs"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                <span style={{ color: "var(--muted)" }}>Email tài khoản: </span>
                <span className="font-semibold text-emerald-500">{userEmail}</span>
              </div>
            )}
            <div>
              <label className="block mb-1 font-medium" style={{ color: "var(--text)" }}>
                Email nhận mã OTP:
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={userEmail || "tenban@example.com"}
                disabled={loading}
                className="w-full px-3 py-2 text-xs rounded-lg outline-none focus:ring-1 focus:ring-[var(--primary)]"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="px-4 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "var(--primary)" }}
              >
                {loading ? "Đang gửi OTP…" : "Gửi mã OTP"}
              </button>
            </div>
          </form>
        )}

        {step === "otp" && (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed opacity-80" style={{ color: "var(--muted)" }}>
              Mã xác thực OTP gồm 6 chữ số đã được gửi đến email của bạn (có hiệu lực trong 5 phút).
            </p>
            <div className="flex items-center justify-between gap-1.5 my-1">
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el
                  }}
                  type="text"
                  maxLength={1}
                  value={digit}
                  disabled={loading}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  onPaste={handleOtpPaste}
                  autoFocus={i === 0}
                  className="w-9 h-11 text-center text-base font-semibold rounded-lg outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                />
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={() => setStep("email")}
                className="text-[11px] opacity-70 hover:opacity-100 underline"
                style={{ color: "var(--muted)" }}
              >
                ← Nhập lại email
              </button>
              <button
                type="button"
                disabled={loading || otpDigits.some((d) => !d)}
                onClick={() => handleVerifyOtp(otpDigits.join(""))}
                className="px-4 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "var(--primary)" }}
              >
                {loading ? "Đang xác thực…" : "Xác thực OTP"}
              </button>
            </div>
          </div>
        )}

        {step === "new_pass" && (
          <form onSubmit={handleSubmitNewPass} className="flex flex-col gap-3">
            {!isUnlocked && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] leading-relaxed">
                ⚠️ Kho khóa hiện đang khóa. Khi đổi mã qua vé OTP, một cặp khóa mới sẽ được tạo. Các tin nhắn cũ trước
                đây sẽ không thể giải mã lại được.
              </div>
            )}
            <div>
              <label className="block mb-1 font-medium" style={{ color: "var(--text)" }}>
                Mã mở khóa E2E mới (tối thiểu 6 ký tự):
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Nhập mã mới (ví dụ 8 số hoặc chữ)..."
                disabled={loading}
                className="w-full px-3 py-2 text-xs rounded-lg outline-none focus:ring-1 focus:ring-[var(--primary)]"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
                autoFocus
              />
            </div>
            <div>
              <label className="block mb-1 font-medium" style={{ color: "var(--text)" }}>
                Xác nhận mã mới:
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Nhập lại mã mới..."
                disabled={loading}
                className="w-full px-3 py-2 text-xs rounded-lg outline-none focus:ring-1 focus:ring-[var(--primary)]"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg opacity-70 hover:opacity-100 transition-opacity"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={loading || !newPass}
                className="px-4 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "var(--primary)" }}
              >
                {loading ? "Đang lưu…" : "Lưu mã mới"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
