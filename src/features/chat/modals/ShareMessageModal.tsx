import { Avatar } from "../../../components/Avatar"
import { AvatarStack } from "../../../components/AvatarStack"
import type { Conversation, Message } from "../../../types/chat"

export interface ShareMessageModalProps {
  shareMsg: Message | null
  conversations: Conversation[]
  selectedId: number | undefined
  shareQuery: string
  setShareQuery: (q: string) => void
  shareTargets: number[]
  toggleShareTarget: (id: number) => void
  shareCaption: string
  setShareCaption: (caption: string) => void
  onClose: () => void
  onSend: () => void
}

export function ShareMessageModal({
  shareMsg,
  conversations,
  selectedId,
  shareQuery,
  setShareQuery,
  shareTargets,
  toggleShareTarget,
  shareCaption,
  setShareCaption,
  onClose,
  onSend,
}: ShareMessageModalProps) {
  if (!shareMsg) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl flex flex-col max-h-[80vh] overflow-hidden"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Chia sẻ tin nhắn tới
          </p>
          <button
            onClick={onClose}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
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

        <div className="px-5 py-3 overflow-y-auto flex-1 flex flex-col gap-3">
          {/* Preview */}
          <div
            className="px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
            }}
          >
            <p className="font-medium mb-1" style={{ color: "var(--text)" }}>
              Tin nhắn sẽ chia sẻ
            </p>
            <div className="flex items-center gap-2.5">
              {shareMsg.file ? (
                shareMsg.file.isImage && shareMsg.file.url ? (
                  <img
                    src={shareMsg.file.url}
                    alt=""
                    className="w-12 h-12 rounded-lg object-contain flex-shrink-0"
                    style={{ backgroundColor: "#111" }}
                  />
                ) : (
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: "var(--primary)" }}
                  >
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: "var(--primary-fg)" }}
                    >
                      FILE
                    </span>
                  </div>
                )
              ) : null}
              <p className="truncate">
                {shareMsg.file ? shareMsg.file.name : shareMsg.text}
              </p>
            </div>
          </div>

          {/* Search */}
          <input
            type="text"
            value={shareQuery}
            onChange={(e) => setShareQuery(e.target.value)}
            placeholder="Tìm bạn bè hoặc phòng..."
            className="px-3 py-2 text-sm rounded-md outline-none w-full"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />

          {/* Target list */}
          <div className="flex flex-col gap-1 max-h-52 overflow-y-auto">
            {conversations
              .filter(
                (c) =>
                  c.id !== selectedId &&
                  c.name.toLowerCase().includes(shareQuery.toLowerCase()),
              )
              .map((c) => {
                const checked = shareTargets.includes(c.id)
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{
                      backgroundColor: checked
                        ? "rgba(59,130,246,0.12)"
                        : "transparent",
                    }}
                  >
                    {c.isGroup ? (
                      <AvatarStack members={c.members ?? []} max={3} />
                    ) : (
                      <Avatar
                        initials={c.initials}
                        online={c.online}
                        size="sm"
                        src={c.avatar}
                      />
                    )}
                    <span
                      className="flex-1 text-sm truncate"
                      style={{ color: "var(--text)" }}
                    >
                      {c.name}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleShareTarget(c.id)}
                      className="w-4 h-4 accent-[var(--primary)]"
                    />
                  </label>
                )
              })}
            {conversations.filter(
              (c) =>
                c.id !== selectedId &&
                c.name.toLowerCase().includes(shareQuery.toLowerCase()),
            ).length === 0 && (
              <p
                className="text-xs text-center py-4"
                style={{ color: "var(--muted)" }}
              >
                Không tìm thấy hội thoại phù hợp
              </p>
            )}
          </div>

          {/* Caption */}
          <input
            type="text"
            value={shareCaption}
            onChange={(e) => setShareCaption(e.target.value)}
            placeholder="Thêm lời nhắn..."
            className="px-3 py-2 text-sm rounded-md outline-none w-full"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>

        <div
          className="px-5 py-3 flex items-center justify-end gap-2 flex-shrink-0"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
            style={{ color: "var(--muted)" }}
          >
            Huỷ
          </button>
          <button
            onClick={onSend}
            disabled={shareTargets.length === 0}
            className="px-5 py-2 text-sm font-semibold rounded-md transition-opacity"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
              opacity: shareTargets.length === 0 ? 0.4 : 1,
              cursor: shareTargets.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Gửi
          </button>
        </div>
      </div>
    </div>
  )
}
