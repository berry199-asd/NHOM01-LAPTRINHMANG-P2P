import { useState } from "react"
import { AuthLayout } from "../components/AuthLayout"
import { PasswordField } from "../components/PasswordField"
import { api } from "../lib/api"

interface Props {
  email: string
  code: string
  onSubmit: () => void
  onBack: () => void
}

export function ResetPassword({ email, code, onSubmit, onBack }: Props) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (password.length < 6) errs.password = "Mật khẩu tối thiểu 6 ký tự."
    if (password !== confirm) errs.confirm = "Mật khẩu xác nhận không khớp."
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setBusy(true)
    setFormError("")
    const r = await api.resetPassword({
      email,
      code,
      new_password: password,
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "invalid_otp") {
        setFormError("Mã xác thực không đúng hoặc đã hết hạn, vui lòng thử lại.")
      } else if (r.error === "network") {
        setFormError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else {
        setFormError("Đặt lại mật khẩu thất bại, vui lòng thử lại.")
      }
      return
    }
    onSubmit()
  }

  return (
    <AuthLayout>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--text)" }}
      >
        Đặt lại mật khẩu
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Tạo mật khẩu mới cho tài khoản của bạn
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <PasswordField
          label="Mật khẩu mới"
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
          label="Xác nhận mật khẩu"
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
          {busy ? "Đang cập nhật…" : "Đặt lại mật khẩu"}
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