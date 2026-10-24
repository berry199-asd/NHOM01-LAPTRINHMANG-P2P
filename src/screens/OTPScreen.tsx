import { useState, useEffect } from "react"
import { AuthLayout } from "../components/AuthLayout"
import { OTPInput } from "../components/OTPInput"
import { api } from "../lib/api"

interface Props {
  purpose: "register" | "forgot"
  email: string
  onConfirm: (code: string) => void
  onBack: () => void
}

export function OTPScreen({ purpose, email, onConfirm, onBack }: Props) {
  const [digits, setDigits] = useState(Array(6).fill(""))
  const [countdown, setCountdown] = useState(60)
  const [canResend, setCanResend] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true)
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const resend = async () => {
    setBusy(true)
    setError("")
    const r =
      purpose === "register"
        ? await api.resendOtp(email)
        : await api.forgotPassword(email)
    setBusy(false)
    if (!r.ok) {
      if (r.error === "network") setError("Không thể kết nối máy chủ.")
      else if (r.error === "resend_cooldown")
        setError("Vui lòng chờ 30 giây rồi thử gửi lại mã.")
      else if (r.error === "mail_failed")
        setError("Lỗi gửi email xác thực qua Google SMTP. Vui lòng thử lại sau.")
      else setError("Không thể gửi lại mã. Vui lòng thử lại.")
      return
    }
    setCountdown(60)
    setCanResend(false)
    setDigits(Array(6).fill(""))
  }

  const full = digits.every((d) => d !== "")

  const handleConfirm = async () => {
    if (!full || busy) return
    const code = digits.join("")
    setBusy(true)
    setError("")
    const r = await api.verifyOtp({
      email,
      code,
      purpose: purpose === "register" ? "register" : "forgot_password",
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "invalid_otp")
        setError("Mã xác thực không đúng hoặc đã hết hạn.")
      else if (r.error === "network")
        setError("Không thể kết nối máy chủ.")
      else setError("Xác thực thất bại, vui lòng thử lại.")
      return
    }
    onConfirm(code)
  }

  return (
    <AuthLayout>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--text)" }}
      >
        Xác thực OTP
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Nhập mã 6 số vừa được gửi đến {email}
      </p>

      <div className="flex flex-col gap-6">
        <OTPInput value={digits} onChange={setDigits} />

        <div className="text-center text-sm" style={{ color: "var(--muted)" }}>
          {canResend ? (
            <button
              onClick={resend}
              disabled={busy}
              className="font-medium underline underline-offset-2 transition-opacity hover:opacity-60"
              style={{ color: "var(--text)" }}
            >
              Gửi lại mã
            </button>
          ) : (
            <span>
              Gửi lại mã sau{" "}
              <span
                className="font-medium tabular-nums"
                style={{ color: "var(--text)" }}
              >
                {countdown}s
              </span>
            </span>
          )}
        </div>

        {error && (
          <p className="text-sm text-center" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}

        <button
          onClick={handleConfirm}
          disabled={!full || busy}
          className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
            opacity: full && !busy ? 1 : 0.35,
            cursor: full && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Đang xác thực…" : "Xác nhận"}
        </button>

        <button
          onClick={onBack}
          className="text-sm flex items-center gap-1.5 transition-opacity hover:opacity-60"
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
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {purpose === "register"
            ? "Quay lại đăng ký"
            : "Quay lại quên mật khẩu"}
        </button>
      </div>
    </AuthLayout>
  )
}