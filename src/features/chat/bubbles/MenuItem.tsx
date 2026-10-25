import type { ReactNode } from "react"

export function MenuItem({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-opacity hover:opacity-70"
      style={{ color: danger ? "var(--error)" : "var(--text)" }}
    >
      {icon}
      {label}
    </button>
  )
}
