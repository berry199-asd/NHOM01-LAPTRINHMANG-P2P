import { useEffect, useRef, useCallback, useState } from "react"

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function generateCode(len = 5) {
  return Array.from(
    { length: len },
    () => CHARS[Math.floor(Math.random() * CHARS.length)],
  ).join("")
}

function drawCaptcha(canvas: HTMLCanvasElement, code: string) {
  const ctx = canvas.getContext("2d")!
  const W = canvas.width
  const H = canvas.height

  ctx.clearRect(0, 0, W, H)

  const isDark = document.documentElement.classList.contains("dark")
  const bg = isDark ? "#242424" : "#fafafa"
  const fg = isDark ? "#e0e0e0" : "#1a1a1a"
  const noise = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // noise lines
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.strokeStyle = noise
    ctx.lineWidth = 1
    ctx.moveTo(Math.random() * W, Math.random() * H)
    ctx.lineTo(Math.random() * W, Math.random() * H)
    ctx.stroke()
  }

  // noise dots
  for (let i = 0; i < 30; i++) {
    ctx.beginPath()
    ctx.fillStyle = noise
    ctx.arc(Math.random() * W, Math.random() * H, 1, 0, Math.PI * 2)
    ctx.fill()
  }

  const charW = W / code.length
  code.split("").forEach((ch, i) => {
    ctx.save()
    ctx.translate(charW * i + charW / 2, H / 2)
    ctx.rotate((Math.random() - 0.5) * 0.4)
    ctx.font = `bold ${H * 0.52}px monospace`
    ctx.fillStyle = fg
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText(ch, 0, 0)
    ctx.restore()
  })
}

interface Props {
  value: string
  onChange: (v: string) => void
  error?: string
}

export function Captcha({ value, onChange, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [code, setCode] = useState(() => generateCode())

  const refresh = useCallback(() => {
    const c = generateCode()
    setCode(c)
    onChange("")
  }, [onChange])

  useEffect(() => {
    if (canvasRef.current) drawCaptcha(canvasRef.current, code)
  }, [code])

  // Redraw when theme changes
  useEffect(() => {
    const obs = new MutationObserver(() => {
      if (canvasRef.current) drawCaptcha(canvasRef.current, code)
    })
    obs.observe(document.documentElement, { attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [code])

  return {
    code,
    element: (
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" style={{ color: "var(--text)" }}>
          Mã xác thực
        </label>
        <div className="flex gap-2 items-center">
          <canvas
            ref={canvasRef}
            width={160}
            height={48}
            className="rounded-md"
            style={{ border: "1px solid var(--border)" }}
          />
          <button
            type="button"
            onClick={refresh}
            className="p-2 rounded-md transition-colors hover:opacity-60"
            style={{ border: "1px solid var(--border)", color: "var(--muted)" }}
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
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="Nhập mã trên"
          maxLength={5}
          className="w-full px-3 py-2.5 text-sm rounded-md outline-none tracking-widest"
          style={{
            backgroundColor: "var(--surface)",
            border: `1px solid ${error ? "var(--error)" : "var(--border)"}`,
            color: "var(--text)",
          }}
        />
        {error && (
          <p className="text-xs" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
      </div>
    ),
  }
}
