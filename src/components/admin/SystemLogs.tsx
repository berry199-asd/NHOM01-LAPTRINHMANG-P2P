import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type ApiAdminLog } from "../../lib/api"

type LogType = "LOGIN" | "LOGOUT" | "LOOKUP" | "TIMEOUT"

const TYPES: LogType[] = ["LOGIN", "LOGOUT", "LOOKUP", "TIMEOUT"]

const TYPE_STYLE: Record<string, { bg: string; fg: string }> = {
  LOGIN: { bg: "rgba(34,197,94,0.12)", fg: "#16a34a" },
  LOGOUT: { bg: "rgba(107,114,128,0.15)", fg: "#6b7280" },
  LOOKUP: { bg: "rgba(56,189,248,0.15)", fg: "#0ea5e9" },
  TIMEOUT: { bg: "rgba(214,69,69,0.12)", fg: "var(--error)" },
}

const RANGE_MS: Record<string, number> = {
  "1h": 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
}

function fmtTime(ms: number | null): string {
  if (!ms) return "—"
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function SystemLogs() {
  const [typeFilter, setTypeFilter] = useState<"all" | LogType>("all")
  const [range, setRange] = useState("24h")
  const [logs, setLogs] = useState<ApiAdminLog[]>([])
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const r = await api.adminLogs(typeFilter, 300)
    if (!r.ok) {
      setError("Không tải được nhật ký hệ thống.")
      return
    }
    setError("")
    setLogs(r.data?.logs ?? [])
  }, [typeFilter])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const span = RANGE_MS[range] ?? RANGE_MS["24h"]
    const cutoff = Date.now() - span
    return logs.filter((l) => l.at == null || l.at >= cutoff)
  }, [logs, range])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | LogType)}
          className="px-3 py-2 text-sm rounded-md outline-none appearance-none"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <option value="all">Mọi loại sự kiện</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="px-3 py-2 text-sm rounded-md outline-none appearance-none"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <option value="1h">1 giờ qua</option>
          <option value="24h">24 giờ qua</option>
          <option value="7d">7 ngày qua</option>
          <option value="30d">30 ngày qua</option>
        </select>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>
          {filtered.length} sự kiện
        </span>
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
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Thời gian
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Loại sự kiện
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Tài khoản
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Chi tiết
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const style = TYPE_STYLE[l.type] ?? {
                bg: "rgba(107,114,128,0.15)",
                fg: "var(--muted)",
              }
              const detail =
                l.detail || (l.ip ? `IP ${l.ip}` : "—")
              return (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td
                    className="px-4 py-2.5 text-xs whitespace-nowrap"
                    style={{ color: "var(--text)" }}
                  >
                    {fmtTime(l.at)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-block px-2 py-0.5 text-[11px] font-semibold rounded"
                      style={{ backgroundColor: style.bg, color: style.fg }}
                    >
                      {l.type}
                    </span>
                  </td>
                  <td
                    className="px-4 py-2.5 font-mono text-xs"
                    style={{ color: "var(--text)" }}
                  >
                    {l.account || (l.user_id ? `#${l.user_id}` : "—")}
                  </td>
                  <td
                    className="px-4 py-2.5 text-xs"
                    style={{ color: "var(--muted)" }}
                  >
                    {detail}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  Không có nhật ký phù hợp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
