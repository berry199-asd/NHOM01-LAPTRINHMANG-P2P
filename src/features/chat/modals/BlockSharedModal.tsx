export interface BlockSharedState {
  userId?: number
  name: string
  groups: { id: number; name: string }[]
}

export interface BlockSharedModalProps {
  blockShared: BlockSharedState | null
  onClose: () => void
  onStay: () => void
  onLeave: () => void
}

export function BlockSharedModal({
  blockShared,
  onClose,
  onStay,
  onLeave,
}: BlockSharedModalProps) {
  if (!blockShared) return null

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-base font-semibold mb-1.5"
          style={{ color: "var(--text)" }}
        >
          Bạn và {blockShared.name} đang ở cùng các nhóm sau
        </h3>
        <ul className="mb-3 flex flex-col gap-1 max-h-40 overflow-y-auto">
          {blockShared.groups.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-2 text-sm py-1"
              style={{ color: "var(--text)" }}
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
                className="flex-shrink-0"
                style={{ color: "var(--muted)" }}
              >
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87" />
                <path d="M16 3.13a4 4 0 010 7.75" />
              </svg>
              {g.name}
            </li>
          ))}
        </ul>
        <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
          Sau khi chặn, bạn vẫn nhìn thấy tin nhắn của {blockShared.name} trong
          các nhóm này. Bạn muốn xử lý thế nào?
        </p>
        <div className="flex gap-3">
          <button
            onClick={onStay}
            className="flex-1 py-2.5 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text)",
              backgroundColor: "var(--bg)",
            }}
          >
            Tiếp tục ở lại nhóm
          </button>
          <button
            onClick={onLeave}
            className="flex-1 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--error)",
              color: "#fff",
            }}
          >
            Rời khỏi nhóm
          </button>
        </div>
      </div>
    </div>
  )
}
