import { ReactNode } from "react"

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{ backgroundColor: "var(--bg)" }}
    >
      <div className="mb-8 flex items-center gap-2">
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
          className="text-base font-semibold tracking-tight"
          style={{ color: "var(--text)" }}
        >
          WorkChat
        </span>
      </div>
      <div
        className="w-full max-w-sm rounded-xl p-8"
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        {children}
      </div>
    </div>
  )
}
