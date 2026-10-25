import type { Message } from "../../../types/chat"
import { colorForName, initialsOf } from "./VoiceBubble"

export function SeenByModal({ msg, onClose }: { msg: Message; onClose: () => void }) {
  const seen = msg.seenBy ?? []
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-[min(340px,90vw)] rounded-2xl shadow-2xl overflow-hidden"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            Ai đã xem
          </span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {seen.length} người
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-opacity hover:opacity-70"
            style={{ color: "var(--muted)" }}
            title="Đóng"
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {seen.length === 0 && (
            <p
              className="px-4 py-8 text-center text-sm"
              style={{ color: "var(--muted)" }}
            >
              Chưa có ai xem tin nhắn này
            </p>
          )}
          {seen.map((s) => (
            <div
              key={s.name}
              className="px-4 py-2.5 flex items-center gap-3"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                style={{ backgroundColor: colorForName(s.name) }}
              >
                {initialsOf(s.name)}
              </span>
              <span
                className="flex-1 min-w-0 text-sm truncate"
                style={{ color: "var(--text)" }}
              >
                {s.name}
              </span>
              <span
                className="text-xs flex items-center gap-1 flex-shrink-0"
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
                  style={{ color: "var(--primary)" }}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Đã xem {s.readAt ? `lúc ${s.readAt}` : "tin nhắn này"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
