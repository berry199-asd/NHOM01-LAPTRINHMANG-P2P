import { useState } from "react"
import { OTPInput } from "./OTPInput"
import { PasswordField } from "./PasswordField"
import { api, clearToken } from "../lib/api"

interface Props {
  currentEmail: string
  onPushToast: (text: string) => void
  onUpdated: (newEmail: string) => void
  onSessionEnded: () => void
  onClose: () => void
}

const STEPS = ["Mật khẩu + email mới", "Xác thực 2 email"]

export function ChangeEmailModal({
  currentEmail,
  onPushToast,
  onUpdated,
  onSessionEnded,
  onClose,
}: Props) {
  const [step, setStep] = useState(0)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newEmailError, setNewEmailError] = useState("")
  const [oldOtp, setOldOtp] = useState<string[]>(Array(6).fill(""))
  const [newOtp, setNewOtp] = useState<string[]>(Array(6).fill(""))
  const [otpError, setOtpError] = useState("")
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const masked = currentEmail.replace(
    /^(.)(.*)(@.*)$/,
    (_, first, rest, domain) => {
      const hidden = "*".repeat(rest.length)
      const at = domain.indexOf("@")
      const dot = domain.lastIndexOf(".")
      const domainStart = at + 1
      const domainEnd = dot === -1 ? domain.length : dot
      const shownDomain = `${domain.slice(domainStart, domainStart + 1)}${"*".repeat(
        domainEnd - domainStart - 1,
      )}${domain.slice(domainEnd)}`
      return `${first}${hidden}${domain.slice(0, at + 1)}${shownDomain}`
    },
  )

  const sendRequest = async () => {
    const errs: string[] = []
    if (password.length < 6) errs.push("Vui lòng nhập mật khẩu hiện tại.")
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!newEmail.trim()) errs.push("Vui lòng nhập email mới.")
    else if (!re.test(newEmail)) errs.push("Email không hợp lệ.")
    else if (newEmail.toLowerCase() === currentEmail.toLowerCase())
      errs.push("Email mới trùng với email hiện tại.")
    if (errs.length) {
      setPasswordError(errs[0])
      return
    }
    setPasswordError("")
    setNewEmailError("")
    setBusy(true)
    const r = await api.changeEmailRequest({
      new_email: newEmail.trim(),
      current_password: password,
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "invalid_credentials") {
        setPasswordError("Mật khẩu hiện tại không đúng.")
      } else if (r.error === "email_taken") {
        setNewEmailError("Email này đã được sử dụng cho tài khoản khác.")
      } else if (r.error === "email_same") {
        setNewEmailError("Email mới trùng với email hiện tại.")
      } else if (r.status === 401) {
        onPushToast("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.")
        onSessionEnded()
      } else if (r.error === "network") {
        onPushToast("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else {
        onPushToast("Không thể gửi mã xác thực, vui lòng thử lại.")
      }
      return
    }
    setOldOtp(Array(6).fill(""))
    setNewOtp(Array(6).fill(""))
    onPushToast(`Mã OTP đã gửi tới ${masked} và ${newEmail.trim()}`)
    setStep(1)
  }

  const resend = async () => {
    if (busy) return
    setBusy(true)
    setOtpError("")
    const r = await api.changeEmailRequest({
      new_email: newEmail.trim(),
      current_password: password,
    })
    setBusy(false)
    if (!r.ok) {
      onPushToast("Không thể gửi lại mã, vui lòng thử lại.")
      return
    }
    onPushToast(`Mã OTP mới đã gửi tới ${masked} và ${newEmail.trim()}`)
  }

  const confirm = async () => {
    const cOld = oldOtp.join("")
    const cNew = newOtp.join("")
    if (cOld.length < 6 || cNew.length < 6) {
      setOtpError("Vui lòng nhập đủ 6 chữ số cho cả hai email.")
      return
    }
    setOtpError("")
    setBusy(true)
    const r = await api.changeEmailConfirm({
      new_email: newEmail.trim(),
      code_old: cOld,
      code_new: cNew,
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "invalid_otp") {
        setOtpError("Mã OTP không chính xác hoặc đã hết hạn.")
      } else if (r.error === "email_taken") {
        setOtpError("Email mới đã được sử dụng cho tài khoản khác.")
      } else if (r.status === 401) {
        onPushToast("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.")
        onSessionEnded()
      } else if (r.error === "network") {
        setOtpError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else {
        setOtpError("Đổi email thất bại, vui lòng thử lại.")
      }
      return
    }
    setDone(true)
    onUpdated(newEmail.trim())
    onPushToast("Đã đổi email đăng nhập thành công")
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
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--text)" }}
          >
            {done ? "Đổi email thành công" : "Đổi tài khoản đăng nhập"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!done && (
          <div className="flex items-center gap-1 mb-6">
            {STEPS.map((label, i) => {
              const active = i === step
              const reached = i < step
              return (
                <div key={label} className="flex-1" title={label}>
                  <div
                    className="h-1 rounded-full transition-colors"
                    style={{
                      backgroundColor: reached
                        ? "var(--primary)"
                        : active
                          ? "var(--primary)"
                          : "var(--border)",
                    }}
                  />
                </div>
              )
            })}
          </div>
        )}

        {step === 0 && (
          <>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
              Nhập mật khẩu hiện tại và email mới. Chúng tôi sẽ gửi mã OTP tới{" "}
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {masked}
              </span>{" "}
              và email mới của bạn.
            </p>
            <div className="flex flex-col gap-4">
              <PasswordField
                label="Mật khẩu hiện tại"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPasswordError("")
                }}
                placeholder="••••••••"
                error={passwordError}
                required
              />
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-xs font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Email mới
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value)
                    setNewEmailError("")
                  }}
                  placeholder="you@example.com"
                  className="text-sm rounded-md px-3 py-2.5 outline-none"
                  style={{
                    color: "var(--text)",
                    backgroundColor: "var(--surface)",
                    border: `1.5px solid ${
                      newEmailError ? "var(--error)" : "var(--border)"
                    }`,
                  }}
                />
                {newEmailError && (
                  <span className="text-xs" style={{ color: "var(--error)" }}>
                    {newEmailError}
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    backgroundColor: "var(--bg)",
                  }}
                >
                  Hủy
                </button>
                <button
                  onClick={sendRequest}
                  disabled={busy}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-60"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  {busy ? "Đang gửi mã…" : "Gửi mã xác nhận"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
              Nhập 6 chữ số đã gửi tới{" "}
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {masked}
              </span>{" "}
              và{" "}
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {newEmail}
              </span>{" "}
              để hoàn tất.
            </p>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Mã gửi tới email hiện tại
                </span>
                <OTPInput value={oldOtp} onChange={setOldOtp} />
              </div>
              <div className="flex flex-col gap-2">
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Mã gửi tới email mới
                </span>
                <OTPInput value={newOtp} onChange={setNewOtp} />
              </div>
              {otpError && (
                <p
                  className="text-xs text-center"
                  style={{ color: "var(--error)" }}
                >
                  {otpError}
                </p>
              )}
              <button
                onClick={resend}
                disabled={busy}
                className="text-xs font-semibold transition-opacity hover:opacity-70"
                style={{ color: "var(--primary)" }}
              >
                Gửi lại mã
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(0)}
                  className="flex-1 py-2.5 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    backgroundColor: "var(--bg)",
                  }}
                >
                  Quay lại
                </button>
                <button
                  onClick={confirm}
                  disabled={busy}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-60"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  {busy ? "Đang xác minh…" : "Hoàn tất"}
                </button>
              </div>
            </div>
          </>
        )}

        {done && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: "rgba(37,166,105,0.15)",
                color: "#25a669",
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p
              className="text-sm text-center"
              style={{ color: "var(--muted)" }}
            >
              Tài khoản của bạn giờ đăng nhập bằng{" "}
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {newEmail}
              </span>
              .
            </p>
            <button
              onClick={() => {
                onClose()
                clearToken()
                onSessionEnded()
              }}
              className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
              style={{
                backgroundColor: "var(--primary)",
                color: "var(--primary-fg)",
              }}
            >
              Đã hiểu
            </button>
          </div>
        )}
      </div>
    </div>
  )
}