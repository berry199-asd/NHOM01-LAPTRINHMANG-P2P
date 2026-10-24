import { useState } from "react"
import { AuthLayout } from "../components/AuthLayout"
import { api } from "../lib/api"

interface Props {
  onSubmit: (email: string) => void
  onBack: () => void
}

export function ForgotPassword({ onSubmit, onBack }: Props) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    const r = await api.forgotPassword(email.trim())
    setBusy(false)
    if (!r.ok) {
      if (r.error === "not_found") {
        setError("Email này chưa được đăng ký.")
      } else if (r.error === "network") {
        setError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else if (r.error === "mail_failed") {
        setError("Không thể gửi email OTP qua Google SMTP. Vui lòng thử lại sau.")
      } else {
        setError("Không thể gửi mã xác thực, vui lòng thử lại.")
      }
      return
    }
    onSubmit(email.trim())
  }

  return (
    <AuthLayout>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--text)" }}
      >
        Quên mật khẩu
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Nhập email đã đăng ký để nhận mã xác thực
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            Email / Tài khoản
          </label>
          <input
            type="text"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError("")
            }}
            placeholder="name@company.com"
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
            required
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 mt-1"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Đang gửi…" : "Gửi mã xác thực"}
        </button>
      </form>

      <button
        onClick={onBack}
        className="mt-5 text-sm flex items-center gap-1.5 transition-opacity hover:opacity-60"
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
        Quay lại đăng nhập
      </button>
    </AuthLayout>
  )
}