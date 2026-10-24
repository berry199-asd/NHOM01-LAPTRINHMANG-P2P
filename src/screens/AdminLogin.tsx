import { useState } from "react"
import { PasswordField } from "../components/PasswordField"
import { api, setAdminToken, type ApiUser } from "../lib/api"

interface Props {
  onLogin: (user: ApiUser, token: string) => void
  onBack: () => void
}

export function AdminLogin({ onLogin, onBack }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError("Vui lòng nhập đầy đủ thông tin đăng nhập.")
      return
    }
    setError("")
    setBusy(true)
    const r = await api.login({ username: email.trim(), password })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "email_not_verified") {
        setError("Tài khoản chưa xác thực email.")
      } else if (r.error === "invalid_credentials") {
        setError("Email hoặc mật khẩu không đúng.")
      } else if (r.error === "network") {
        setError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else {
        setError("Đăng nhập thất bại, vui lòng thử lại.")
      }
      return
    }
    const user = r.data?.user
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      setError("Tài khoản không có quyền truy cập cổng quản trị.")
      return
    }
    setAdminToken(r.data!.token)
    onLogin(user, r.data!.token)
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* Brand bar */}
      <header
        className="flex items-center justify-between px-6 h-14 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
            }}
          >
            W
          </div>
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            WorkChat
          </span>
        </div>
        <button
          onClick={onBack}
          className="text-sm font-medium transition-opacity hover:opacity-60"
          style={{ color: "var(--muted)" }}
        >
          ← Quay lại
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-xl"
          style={{
            backgroundColor: "var(--bg)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="px-8 pt-8 pb-6 border-t-4 rounded-t-xl"
            style={{ borderTopColor: "var(--primary)" }}
          >
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center mb-4"
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            </div>
            <span
              className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mb-2 tracking-wide"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              CỔNG QUẢN TRỊ
            </span>
            <h1
              className="text-xl font-semibold mb-1"
              style={{ color: "var(--text)" }}
            >
              Đăng nhập Admin
            </h1>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
              Dành cho quản trị viên hệ thống
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <p
                  className="text-sm text-center"
                  style={{ color: "var(--error)" }}
                >
                  {error}
                </p>
              )}
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
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@quan-tri.vn"
                  className="w-full px-3 py-2.5 text-sm rounded-md outline-none"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                  required
                />
              </div>

              <PasswordField
                label="Mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 mt-1 disabled:opacity-60"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                }}
              >
                {busy ? "Đang đăng nhập…" : "Đăng nhập"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
