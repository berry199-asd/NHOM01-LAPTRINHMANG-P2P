import { useCallback, useEffect, useState } from "react"
import { api, type ApiAdminOverview } from "../../lib/api"

const CARDS: { key: keyof ApiAdminOverview; label: string }[] = [
  { key: "total_users", label: "Tổng tài khoản" },
  { key: "online_peers", label: "Đang online" },
  { key: "p2p_peers", label: "Kết nối P2P hiện tại" },
  { key: "pending_reports", label: "Báo cáo chờ xử lý" },
]

export function Overview() {
  const [data, setData] = useState<ApiAdminOverview | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const r = await api.adminOverview()
    setLoading(false)
    if (!r.ok) {
      setError(
        r.error === "forbidden"
          ? "Tài khoản không có quyền quản trị."
          : "Không tải được số liệu tổng quan.",
      )
      return
    }
    setError("")
    setData(r.data ?? null)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div>
      {error && (
        <p className="text-sm mb-3" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {CARDS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-xl p-5"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          >
            <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
              {label}
            </p>
            <p
              className="text-3xl font-semibold"
              style={{ color: "var(--text)" }}
            >
              {loading ? "…" : (data?.[key] ?? 0)}
            </p>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Phiên đăng nhập đang mở
          </h3>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Cập nhật mỗi 10 giây
          </span>
        </div>
        <p className="text-2xl font-semibold" style={{ color: "var(--text)" }}>
          {loading ? "…" : (data?.sessions ?? 0)}
        </p>
        <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
          Số kết nối WebSocket đang mở tới máy chủ. Biểu đồ xu hướng online theo
          thời gian chưa được ghi nhận.
        </p>
      </div>
    </div>
  )
}
