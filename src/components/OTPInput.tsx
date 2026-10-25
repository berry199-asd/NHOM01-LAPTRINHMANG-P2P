import { useRef, ClipboardEvent, KeyboardEvent } from "react"

interface Props {
  value: string[]
  onChange: (v: string[]) => void
}

export function OTPInput({ value, onChange }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([])

  const update = (idx: number, ch: string) => {
    const next = [...value]
    next[idx] = ch
    onChange(next)
    if (ch && idx < 5) refs.current[idx + 1]?.focus()
  }

  const handleKey = (idx: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[idx] && idx > 0) {
      refs.current[idx - 1]?.focus()
    }
    if (e.key === "ArrowLeft" && idx > 0) refs.current[idx - 1]?.focus()
    if (e.key === "ArrowRight" && idx < 5) refs.current[idx + 1]?.focus()
  }

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
    const next = Array(6).fill("")
    text.split("").forEach((ch, i) => {
      next[i] = ch
    })
    onChange(next)
    const focusIdx = Math.min(text.length, 5)
    refs.current[focusIdx]?.focus()
  }

  return (
    <div className="flex gap-3 justify-center">
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, "").slice(-1)
            update(i, ch)
          }}
          onKeyDown={(e) => handleKey(i, e)}
          onPaste={handlePaste}
          className="w-12 h-12 text-center text-lg font-semibold rounded-md outline-none transition-all"
          style={{
            backgroundColor: "var(--surface)",
            border: `1.5px solid ${digit ? "var(--primary)" : "var(--border)"}`,
            color: "var(--text)",
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}
