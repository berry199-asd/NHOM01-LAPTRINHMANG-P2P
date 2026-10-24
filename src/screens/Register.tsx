import { useState } from "react"
import { AuthLayout } from "../components/AuthLayout"
import { PasswordField } from "../components/PasswordField"
import { api } from "../lib/api"

interface Props {
  onSubmit: (email: string) => void
  onLogin: () => void
}

export function Register({ onSubmit, onLogin }: Props) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [dob, setDob] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState("")
  const [busy, setBusy] = useState(false)

  const calcAge = (value: string) => {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return -1
    const now = new Date()
    let age = now.getFullYear() - d.getFullYear()
    const m = now.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
    return age
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = "Vui lòng nhập họ và tên."
    if (!dob) e.dob = "Vui lòng chọn ngày sinh."
    else if (calcAge(dob) < 13)
      e.dob = "Bạn phải từ 13 tuổi trở lên để đăng ký tài khoản."
    if (!email.trim()) e.email = "Vui lòng nhập email."
    if (password.length < 6) e.password = "Mật khẩu tối thiểu 6 ký tự."
    if (password !== confirm) e.confirm = "Mật khẩu nhập lại không khớp."
    return e
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const e2 = validate()
    if (Object.keys(e2).length) {
      setErrors(e2)
      return
    }
    setBusy(true)
    setFormError("")
    const r = await api.register({
      email: email.trim(),
      password,
      display_name: name.trim(),
      date_of_birth: dob || undefined,
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "email_taken") {
        setFormError("Email này đã được đăng ký. Bạn hãy đăng nhập.")
      } else if (r.error === "username_taken") {
        setFormError("Tên tài khoản đã tồn tại.")
      } else if (r.error === "network") {
        setFormError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else if (r.error === "mail_failed") {
        setFormError("Không thể gửi email OTP qua Google SMTP. Vui lòng thử lại sau.")
      } else {
        setFormError("Đăng ký thất bại, vui lòng thử lại.")
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
        Đăng ký
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Tạo tài khoản mới
      </p>

      <button
        type="button"
        disabled
        title="Chưa hỗ trợ"
        className="w-full flex items-center justify-center gap-2.5 py-2.5 text-sm font-medium rounded-md opacity-60 cursor-not-allowed mb-4"
        style={{
          border: "1px solid var(--border)",
          color: "var(--text)",
          backgroundColor: "var(--bg)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Đăng ký bằng Google (chưa hỗ trợ)
      </button>

      <div className="relative flex items-center mb-4">
        <div
          className="flex-1 h-px"
          style={{ backgroundColor: "var(--border)" }}
        />
        <span className="px-3 text-xs" style={{ color: "var(--muted)" }}>
          hoặc
        </span>
        <div
          className="flex-1 h-px"
          style={{ backgroundColor: "var(--border)" }}
        />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            Họ và tên
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErrors((v) => ({ ...v, name: "" }))
            }}
            placeholder="Nguyễn Văn An"
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: `1px solid ${
                errors.name ? "var(--error)" : "var(--border)"
              }`,
              color: "var(--text)",
            }}
            required
          />
          {errors.name && (
            <p className="text-xs" style={{ color: "var(--error)" }}>
              {errors.name}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErrors((v) => ({ ...v, email: "" }))
            }}
            placeholder="name@company.com"
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: `1px solid ${
                errors.email ? "var(--error)" : "var(--border)"
              }`,
              color: "var(--text)",
            }}
            required
          />
          {errors.email && (
            <p className="text-xs" style={{ color: "var(--error)" }}>
              {errors.email}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            Ngày sinh
          </label>
          <input
            type="date"
            value={dob}
            max={new Date().toISOString().split("T")[0]}
            onChange={(e) => {
              setDob(e.target.value)
              setErrors((v) => ({ ...v, dob: "" }))
            }}
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: `1px solid ${
                errors.dob ? "var(--error)" : "var(--border)"
              }`,
              color: "var(--text)",
            }}
            required
          />
          {errors.dob ? (
            <p className="text-xs" style={{ color: "var(--error)" }}>
              {errors.dob}
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Phải đủ 13 tuổi trở lên để tạo tài khoản.
            </p>
          )}
        </div>

        <PasswordField
          label="Mật khẩu"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((v) => ({ ...v, password: "" }))
          }}
          placeholder="Tối thiểu 6 ký tự"
          error={errors.password}
          required
        />

        <PasswordField
          label="Nhập lại mật khẩu"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            setErrors((v) => ({ ...v, confirm: "" }))
          }}
          placeholder="••••••••"
          error={errors.confirm}
          required
        />

        {formError && (
          <p className="text-sm" style={{ color: "var(--error)" }}>
            {formError}
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
          {busy ? "Đang xử lý…" : "Đăng ký"}
        </button>
      </form>

      <p className="text-sm text-center mt-5" style={{ color: "var(--muted)" }}>
        Đã có tài khoản?{" "}
        <button
          onClick={onLogin}
          className="font-medium underline underline-offset-2"
          style={{ color: "var(--text)" }}
        >
          Đăng nhập
        </button>
      </p>
    </AuthLayout>
  )
}
