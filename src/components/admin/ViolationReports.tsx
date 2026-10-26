import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type ApiAdminReport } from "../../lib/api"

type ReportStatus = "pending" | "resolved" | "dismissed"

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: "Chờ xử lý",
  resolved: "Đã xử lý",
  dismissed: "Bỏ qua",
}

const STATUS_STYLE: Record<ReportStatus, { bg: string; fg: string }> = {
  pending: { bg: "rgba(234,179,8,0.14)", fg: "#a16207" },
  resolved: { bg: "rgba(34,197,94,0.12)", fg: "#16a34a" },
  dismissed: { bg: "rgba(148,163,184,0.18)", fg: "var(--muted)" },
}

function fmtTime(ms: number | null): string {
  if (!ms) return "—"
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

function initialsOf(name: string | null): string {
  const src = (name || "?").trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export function ViolationReports() {
  const [reports, setReports] = useState<ApiAdminReport[]>([])
  const [statusFilter, setStatusFilter] = useState<"all" | ReportStatus>("all")
  const [selected, setSelected] = useState<ApiAdminReport | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await api.adminReports("all", 200)
    setLoading(false)
    if (!r.ok) {
      setError(
        r.error === "forbidden"
          ? "Tài khoản không có quyền quản trị."
          : "Không tải được danh sách báo cáo.",
      )
      return
    }
    setError("")
    setReports(r.data?.reports ?? [])
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? reports
        : reports.filter((r) => r.status === statusFilter),
    [reports, statusFilter],
  )

  const setStatus = async (id: number, status: ReportStatus) => {
    const prev = reports
    setReports((p) => p.map((r) => (r.id === id ? { ...r, status } : r)))
    setSelected((s) => (s && s.id === id ? { ...s, status } : s))
    const r = await api.adminReportStatus(id, status)
    if (!r.ok) {
      setReports(prev)
      setError("Không cập nhật được trạng thái báo cáo.")
    } else {
      setError("")
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {(["all", "pending", "resolved", "dismissed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-opacity hover:opacity-70"
            style={
              statusFilter === s
                ? {
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }
                : {
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }
            }
          >
            {s === "all" ? "Tất cả" : STATUS_LABEL[s]}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {filtered.length}/{reports.length} báo cáo
          </span>
          <button
            onClick={() => load()}
            disabled={loading}
            className="px-2.5 py-1 text-xs rounded border transition-opacity hover:opacity-70"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            {loading ? "Đang tải…" : "Làm mới"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm mb-3" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              style={{
                backgroundColor: "var(--surface)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <th
                className="text-left px-4 py-3 font-medium w-48"
                style={{ color: "var(--muted)" }}
              >
                Người báo cáo
              </th>
              <th
                className="text-left px-4 py-3 font-medium w-40"
                style={{ color: "var(--muted)" }}
              >
                Đối tượng
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Lý do
              </th>
              <th
                className="text-left px-4 py-3 font-medium w-32"
                style={{ color: "var(--muted)" }}
              >
                Thời gian
              </th>
              <th
                className="text-left px-4 py-3 font-medium w-32"
                style={{ color: "var(--muted)" }}
              >
                Trạng thái
              </th>
              <th
                className="text-right px-4 py-3 font-medium w-28"
                style={{ color: "var(--muted)" }}
              >
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const st = (r.status as ReportStatus) ?? "pending"
              return (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {initialsOf(r.reporter)}
                      </div>
                      <span style={{ color: "var(--text)" }}>
                        {r.reporter ?? `#${r.reporter_id}`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text)" }}>
                    {r.target_type} · {r.target_id}
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    {r.reason}
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    {fmtTime(r.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full"
                      style={{
                        backgroundColor: STATUS_STYLE[st].bg,
                        color: STATUS_STYLE[st].fg,
                      }}
                    >
                      {STATUS_LABEL[st]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelected(r)}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-md transition-opacity hover:opacity-70"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      Xem chi tiết
                    </button>
                  </td>
                </tr>
              )
            })}
            {(filtered.length === 0 || loading) && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  {loading ? "Đang tải…" : "Không có báo cáo vi phạm nào."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        >
          <div
            className="w-full max-w-md rounded-xl p-5"
            style={{
              backgroundColor: "var(--bg)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3
                className="text-base font-semibold"
                style={{ color: "var(--text)" }}
              >
                Báo cáo #{selected.id}
              </h3>
              <button
                onClick={() => setSelected(null)}
                className="text-sm transition-opacity hover:opacity-60"
                style={{ color: "var(--muted)" }}
              >
                ✕
              </button>
            </div>
            <div className="text-sm space-y-2 mb-4">
              <p style={{ color: "var(--text)" }}>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  Từ:{" "}
                </span>
                {selected.reporter ?? `#${selected.reporter_id}`}
                <span
                  className="text-xs mx-2"
                  style={{ color: "var(--muted)" }}
                >
                  →
                </span>
                {selected.target_type} · {selected.target_id}
              </p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {selected.reason} · {fmtTime(selected.created_at)}
              </p>
              <div
                className="rounded-lg p-3 text-sm"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
                  Ghi chú bằng chứng (do người báo cáo cung cấp)
                </p>
                <p style={{ color: "var(--text)" }}>
                  {selected.evidence_note || "Không có ghi chú."}
                </p>
              </div>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Nội dung tin nhắn được mã hoá đầu-cuối nên máy chủ không lưu và
                không hiển thị được.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSelected(null)}
                className="px-3 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                Đóng
              </button>
              {selected.status !== "dismissed" && (
                <button
                  onClick={() => setStatus(selected.id, "dismissed")}
                  className="px-3 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                  }}
                >
                  Bỏ qua
                </button>
              )}
              {selected.status !== "resolved" && (
                <button
                  onClick={() => setStatus(selected.id, "resolved")}
                  className="px-3 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-70"
                  style={{
                    backgroundColor: "var(--primary)",
                    color: "var(--primary-fg)",
                  }}
                >
                  Đánh dấu Đã xử lý
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
