import { useState, forwardRef } from "react"

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
}

export const PasswordField = forwardRef<HTMLInputElement, Props>(
  ({ label, error, ...rest }, ref) => {
    const [show, setShow] = useState(false)

    return (
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {label}
        </label>
        <div className="relative">
          <input
            ref={ref}
            type={show ? "text" : "password"}
            className="w-full px-3 py-2.5 pr-10 text-sm rounded-md outline-none transition-all"
            style={{
              backgroundColor: "var(--surface)",
              border: `1px solid ${error ? "var(--error)" : "var(--border)"}`,
              color: "var(--text)",
            }}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
            tabIndex={-1}
          >
            {show ? (
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
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
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
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {error && (
          <p className="text-xs" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
      </div>
    )
  },
)
