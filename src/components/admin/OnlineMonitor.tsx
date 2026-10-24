import { useCallback, useEffect, useState } from "react"
import { api, type ApiAdminPeer } from "../../lib/api"

function initialsOf(name: string, username: string): string {
  const src = (name || username || "?").trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

function sinceLabel(secs: number): string {
  if (secs < 60) return `${secs} giây trước`
  if (secs < 3600) return `${Math.floor(secs / 60)} phút trước`
  return `${Math.floor(secs / 3600)} giờ trước`
}

export function OnlineMonitor() {
  const [peers, setPeers] = useState<ApiAdminPeer[]>([])
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const r = await api.adminPeers()
    if (!r.ok) {
      setError("Không tải được danh sách peer đang online.")
      return
    }
    setError("")
    setPeers(r.data?.peers ?? [])
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full"
          style={{ backgroundColor: "rgba(34,197,94,0.12)", color: "#16a34a" }}
        >
          <span className="live-dot" />
          LIVE
        </span>
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          {peers.length} người dùng đang online
        </span>
      </div>

      {error && (
        <p className="text-sm mb-3" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      {peers.length === 0 ? (
        <div
          className="rounded-xl p-10 text-center text-sm"
          style={{
            backgroundColor: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--muted)",
          }}
        >
          Chưa có người dùng nào đang online.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {peers.map((p) => {
            const name = p.display_name || p.username
            return (
              <div
                key={p.id}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="relative">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {initialsOf(name, p.username)}
                    </div>
                    <span
                      className="absolute bottom-0 right-0 w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: "#16a34a",
                        border: "2px solid var(--bg)",
                      }}
                    />
                  </div>
                  <span
                    className="px-1.5 py-0.5 text-[10px] font-medium rounded"
                    style={
                      p.connection === "p2p"
                        ? {
                            backgroundColor: "rgba(56,189,248,0.15)",
                            color: "#0ea5e9",
                          }
                        : {
                            backgroundColor: "rgba(245,158,11,0.15)",
                            color: "#d97706",
                          }
                    }
                  >
                    {p.connection === "p2p" ? "P2P" : "Qua server"}
                  </span>
                </div>
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--text)" }}
                >
                  {name}
                </p>
                <p
                  className="text-xs truncate mb-2"
                  style={{ color: "var(--muted)" }}
                >
                  {p.email}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Online {sinceLabel(p.online_secs)}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
