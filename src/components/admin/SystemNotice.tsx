import { useCallback, useEffect, useState } from "react"
import { api } from "../../lib/api"

export function SystemNotice() {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [preview, setPreview] = useState(false)
  const [sent, setSent] = useState(false)
  const [reached, setReached] = useState(0)
  const [sending, setSending] = useState(false)
  const [online, setOnline] = useState<number | null>(null)
  const [error, setError] = useState("")

  const loadOnline = useCallback(async () => {
    const r = await api.adminOverview()
    if (r.ok) setOnline(r.data?.online_peers ?? 0)
  }, [])

  useEffect(() => {
    loadOnline()
    const t = setInterval(loadOnline, 10000)
    return () => clearInterval(t)
  }, [loadOnline])

  const onlineLabel = online == null ? "…" : online

  const openPreview = () => {
    if (!title.trim() || !content.trim()) {
      setError("Vui lòng nhập đầy đủ tiêu đề và nội dung.")
      return
    }
    setError("")
    setPreview(true)
  }

  const doSend = async () => {
    setSending(true)
    const r = await api.adminSendBroadcast(title.trim(), content.trim())
    setSending(false)
    setPreview(false)
    if (!r.ok) {
      setError("Không gửi được thông báo. Vui lòng thử lại.")
      return
    }
    setError("")
    setReached(r.data?.reached ?? 0)
    setSent(true)
    setTitle("")
    setContent("")
    setTimeout(() => setSent(false), 5000)
  }

  return (
    <div className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            Tiêu đề
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="VD: Bảo trì hệ thống 22h–23h tối nay"
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            className="text-sm font-medium"
            style={{ color: "var(--text)" }}
          >
            Nội dung
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="Nhập nội dung thông báo..."
            className="w-full px-3 py-2.5 text-sm rounded-md outline-none resize-none"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          />
        </div>

        {error && (
          <p className="text-xs" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}

        <button
          onClick={openPreview}
          className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
          }}
        >
          Gửi tới tất cả người dùng đang online
        </button>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Hiện có {onlineLabel} người online. Thông báo sẽ hiển thị dạng toast
          cho từng người.
        </p>
      </div>

      {/* Toast preview */}
      {preview && (
        <div
          className="fixed left-1/2 top-5 z-[80] -translate-x-1/2 w-[min(92vw,420px)] rounded-xl p-4 flex flex-col gap-3"
          style={{
            backgroundColor: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          }}
        >
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full self-start"
            style={{
              backgroundColor: "rgba(56,189,248,0.15)",
              color: "#0ea5e9",
            }}
          >
            <span className="live-dot" />
            XEM TRƯỚC
          </span>
          <div
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            {title}
          </div>
          <div className="text-sm" style={{ color: "var(--text)" }}>
            {content}
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              Sẽ gửi tới {onlineLabel} người đang online
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPreview(false)}
                disabled={sending}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                Huỷ
              </button>
              <button
                onClick={doSend}
                disabled={sending}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-fg)",
                }}
              >
                {sending ? "Đang gửi…" : "Gửi thật"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sent confirmation toast */}
      {sent && (
        <div
          className="fixed left-1/2 top-5 z-[80] -translate-x-1/2 flex items-center gap-2 rounded-lg px-4 py-3"
          style={{
            backgroundColor: "#ecfdf5",
            border: "1px solid #a7f3d0",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "#16a34a" }}
          />
          <p className="text-sm" style={{ color: "#065f46" }}>
            Đã gửi thông báo tới {reached} người đang online thành công.
          </p>
        </div>
      )}
    </div>
  )
}
