import { useState, useRef, useEffect } from "react"
import { AuthLayout } from "../components/AuthLayout"
import { PasswordField } from "../components/PasswordField"
import { api, setToken } from "../lib/api"

interface Props {
  onLogin: () => void
  onNeedsOtp: (email: string) => void
  onRegister: () => void
  onForgot: () => void
  onAdmin: () => void
}

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
function genCode() {
  return Array.from(
    { length: 5 },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("")
}

function drawCaptcha(canvas: HTMLCanvasElement, code: string) {
  const ctx = canvas.getContext("2d")!
  const W = canvas.width,
    H = canvas.height
  const isDark = document.documentElement.classList.contains("dark")
  ctx.fillStyle = isDark ? "#242424" : "#fafafa"
  ctx.fillRect(0, 0, W, H)
  const noise = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)"
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.strokeStyle = noise
    ctx.lineWidth = 1
    ctx.moveTo(Math.random() * W, Math.random() * H)
    ctx.bezierCurveTo(
      Math.random() * W,
      Math.random() * H,
      Math.random() * W,
      Math.random() * H,
      Math.random() * W,
      Math.random() * H,
    )
    ctx.stroke()
  }
  for (let i = 0; i < 25; i++) {
    ctx.beginPath()
    ctx.fillStyle = noise
    ctx.arc(Math.random() * W, Math.random() * H, 1, 0, Math.PI * 2)
    ctx.fill()
  }
  const charW = W / code.length
  code.split("").forEach((ch, i) => {
    ctx.save()
    ctx.translate(charW * i + charW / 2, H / 2 + (Math.random() - 0.5) * 4)
    ctx.rotate((Math.random() - 0.5) * 0.45)
    const fonts = ["monospace", "serif"]
    ctx.font = `bold ${H * 0.52}px ${fonts[Math.floor(Math.random() * fonts.length)]}`
    ctx.fillStyle = isDark ? "#e0e0e0" : "#1a1a1a"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
}

export function Login({
  onLogin,
  onNeedsOtp,
  onRegister,
  onForgot,
  onAdmin,
}: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [captchaInput, setCaptchaInput] = useState("")
  const [captchaCode, setCaptchaCode] = useState(genCode)
  const [captchaError, setCaptchaError] = useState("")
  const [formError, setFormError] = useState("")
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) drawCaptcha(canvasRef.current, captchaCode)
  }, [captchaCode])

  useEffect(() => {
    const obs = new MutationObserver(() => {
      if (canvasRef.current) drawCaptcha(canvasRef.current, captchaCode)
    })
    obs.observe(document.documentElement, { attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [captchaCode])

  const refresh = () => {
    setCaptchaCode(genCode())
    setCaptchaInput("")
    setCaptchaError("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (captchaInput.toUpperCase() !== captchaCode) {
      setCaptchaError("Mã captcha không đúng.")
      setCaptchaCode(genCode())
      setCaptchaInput("")
      return
    }
    setBusy(true)
    setFormError("")
    const r = await api.login({ username: email.trim(), password })
    setBusy(false)
    if (!r.ok) {
      if (r.error === "email_not_verified") {
        onNeedsOtp(email.trim())
        return
      }
      if (r.error === "invalid_credentials") {
        setFormError("Email/tài khoản hoặc mật khẩu không đúng.")
      } else if (r.error === "too_many_attempts") {
        setFormError("Quá nhiều lần thử không thành công, vui lòng thử lại sau 15 phút.")
      } else if (r.error === "network") {
        setFormError("Không thể kết nối máy chủ, vui lòng thử lại.")
      } else {
        setFormError("Đăng nhập thất bại, vui lòng thử lại.")
      }
      return
    }
    if (r.data?.token) setToken(r.data.token)
    onLogin()
  }

  return (
    <AuthLayout>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--text)" }}
      >
        Đăng nhập
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Chào mừng trở lại
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
            onChange={(e) => setEmail(e.target.value)}
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

        <PasswordField
          label="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />

        <div className="flex flex-col gap-1">
          <div className="flex gap-2 items-center">
            <canvas
              ref={canvasRef}
              width={160}
              height={48}
              className="rounded-md flex-shrink-0"
              style={{ border: "1px solid var(--border)" }}
            />
            <button
              type="button"
              onClick={refresh}
              className="p-2 rounded-md transition-opacity hover:opacity-60"
              style={{
                border: "1px solid var(--border)",
                color: "var(--muted)",
              }}
              title="Đổi mã"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
          </div>
          <input
            type="text"
            value={captchaInput}
            onChange={(e) => {
              setCaptchaInput(e.target.value.toUpperCase())
              setCaptchaError("")
            }}
            placeholder="Nhập mã trên"
            maxLength={5}
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none tracking-widest font-mono"
            style={{
              backgroundColor: "var(--surface)",
              border: `1px solid ${
                captchaError ? "var(--error)" : "var(--border)"
              }`,
              color: "var(--text)",
            }}
            required
          />
          {captchaError && (
            <p className="text-xs" style={{ color: "var(--error)" }}>
              {captchaError}
            </p>
          )}
        </div>

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
          {busy ? "Đang xử lý…" : "Đăng nhập"}
        </button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-2">
        <button
          onClick={onForgot}
          className="text-sm transition-opacity hover:opacity-60"
          style={{ color: "var(--muted)" }}
        >
          Quên mật khẩu?
        </button>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Chưa có tài khoản?{" "}
          <button
            onClick={onRegister}
            className="font-medium underline underline-offset-2"
            style={{ color: "var(--text)" }}
          >
            Đăng ký
          </button>
        </p>
        <button
          onClick={onAdmin}
          className="text-xs mt-1 transition-opacity hover:opacity-60"
          style={{ color: "var(--muted)" }}
        >
          Cổng quản trị →
        </button>
      </div>
    </AuthLayout>
  )
}
