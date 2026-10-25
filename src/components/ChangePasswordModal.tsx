import { useState } from "react"
import { PasswordField } from "./PasswordField"
import { api, clearToken } from "../lib/api"

interface Props {
  onPushToast: (text: string) => void
  onSessionEnded: () => void
  onClose: () => void
}

export function ChangePasswordModal({ onPushToast, onSessionEnded, onClose }: Props) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState("")
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!current) errs.current = "Vui lòng nhập mật khẩu hiện tại."
    if (next.length < 6) errs.next = "Mật khẩu tối thiểu 6 ký tự."
    if (next !== confirm) errs.confirm = "Mật khẩu xác nhận không khớp."
    if (next === current)
      errs.next = "Mật khẩu mới không được trùng mật khẩu hiện tại."
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setBusy(true)
    setFormError("")
    const r = await api.changePassword({
      current_password: current,
      new_password: next,
    })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "invalid_credentials") {
        setFormError("Mật khẩu hiện tại không đúng.")
      } else if (r.error === "password_same") {
        setFormError("Mật khẩu mới không được trùng mật khẩu hiện tại.")
      } else if (r.status === 401) {
        setFormError("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.")
        onSessionEnded()
      } else if (r.error === "network") {
        setFormError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else {
        setFormError("Đổi mật khẩu thất bại, vui lòng thử lại.")
      }
      return
    }
    clearToken()
    onPushToast("Mật khẩu đã được đổi, vui lòng đăng nhập lại")
    onSessionEnded()
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
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--text)" }}
          >
            Đổi mật khẩu
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <PasswordField
            label="Mật khẩu hiện tại"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value)
              setErrors((v) => ({ ...v, current: "" }))
            }}
            placeholder="••••••••"
            error={errors.current}
            required
          />

          <PasswordField
            label="Mật khẩu mới"
            value={next}
            onChange={(e) => {
              setNext(e.target.value)
              setErrors((v) => ({ ...v, next: "" }))
            }}
            placeholder="Tối thiểu 6 ký tự"
            error={errors.next}
            required
          />

          <PasswordField
            label="Xác nhận mật khẩu mới"
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

          <div className="flex gap-3 mt-2">
            <button
              type="button"
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
              type="submit"
              disabled={busy}
              className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{
                backgroundColor: "var(--primary)",
                color: "var(--primary-fg)",
              }}
            >
              {busy ? "Đang xử lý…" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
