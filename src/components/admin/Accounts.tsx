import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type ApiAdminUser } from "../../lib/api"

type Role = "Người dùng" | "Kiểm duyệt viên" | "Quản trị viên"

const ROLES: Role[] = ["Người dùng", "Kiểm duyệt viên", "Quản trị viên"]

const ROLE_LABEL: Record<string, Role> = {
  user: "Người dùng",
  moderator: "Kiểm duyệt viên",
  admin: "Quản trị viên",
}

function initialsOf(name: string, email: string): string {
  const src = (name || email || "?").trim()
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export function Accounts() {
  const [rows, setRows] = useState<ApiAdminUser[]>([])
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "locked">(
    "all",
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await api.adminUsers("")
    setLoading(false)
    if (!r.ok) {
      setError(
        r.error === "forbidden"
          ? "Tài khoản không có quyền quản trị."
          : "Không tải được danh sách tài khoản.",
      )
      return
    }
    setError("")
    setRows(r.data?.users ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((a) => {
      const name = a.display_name || a.username
      if (
        q &&
        !name.toLowerCase().includes(q) &&
        !a.email.toLowerCase().includes(q) &&
        !a.username.toLowerCase().includes(q)
      )
        return false
      if (roleFilter !== "all" && ROLE_LABEL[a.role] !== roleFilter) return false
      const status = a.locked ? "locked" : "active"
      if (statusFilter !== "all" && status !== statusFilter) return false
      return true
    })
  }, [rows, search, roleFilter, statusFilter])

  const toggleLock = async (a: ApiAdminUser) => {
    const lock = !a.locked
    setBusyId(a.id)
    const r = await api.adminSetLocked(a.id, lock)
    setBusyId(null)
    if (r.ok) {
      setRows((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, locked: lock } : x)),
      )
    }
  }

  const changeRole = async (a: ApiAdminUser, role: string) => {
    const prevRole = a.role
    setBusyId(a.id)
    setRows((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, role } : x)),
    )
    const r = await api.adminSetRole(a.id, role)
    setBusyId(null)
    if (!r.ok) {
      setRows((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, role: prevRole } : x)),
      )
      setError(
        r.error === "cannot_change_own_role"
          ? "Không thể tự đổi vai trò của chính mình."
          : "Không đổi được vai trò.",
      )
      return
    }
    setError("")
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm kiếm theo tên hoặc email..."
          className="w-64 px-3 py-2 text-sm rounded-md outline-none"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as "all" | Role)}
          className="px-3 py-2 text-sm rounded-md outline-none appearance-none"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <option value="all">Mọi vai trò</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | "active" | "locked")
          }
          className="px-3 py-2 text-sm rounded-md outline-none appearance-none"
          style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          <option value="all">Mọi trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="locked">Đã khoá</option>
        </select>
        <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>
          {filtered.length}/{rows.length} tài khoản
        </span>
      </div>

      {error && (
        <p className="text-sm mb-3" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      {/* Table */}
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
                Người dùng
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Vai trò
              </th>
              <th
                className="text-left px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Trạng thái
              </th>
              <th
                className="text-right px-4 py-3 font-medium"
                style={{ color: "var(--muted)" }}
              >
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const name = a.display_name || a.username
              return (
                <tr
                  key={a.id}
                  className="hover:opacity-80"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {initialsOf(name, a.email)}
                      </div>
                      <div className="flex flex-col">
                        <span style={{ color: "var(--text)" }}>{name}</span>
                        <span
                          className="text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          {a.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={a.role}
                      onChange={(e) => changeRole(a, e.target.value)}
                      disabled={busyId === a.id}
                      className="px-2 py-1.5 text-xs rounded-md outline-none appearance-none disabled:opacity-50"
                      style={{
                        backgroundColor: "var(--surface)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      <option value="user">Người dùng</option>
                      <option value="moderator">Kiểm duyệt viên</option>
                      <option value="admin">Quản trị viên</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-full"
                      style={
                        !a.locked
                          ? {
                              backgroundColor: "rgba(34,197,94,0.12)",
                              color: "#16a34a",
                            }
                          : {
                              backgroundColor: "rgba(214,69,69,0.12)",
                              color: "var(--error)",
                            }
                      }
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          backgroundColor: !a.locked
                            ? "#16a34a"
                            : "var(--error)",
                        }}
                      />
                      {!a.locked ? "Hoạt động" : "Đã khoá"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => toggleLock(a)}
                        disabled={busyId === a.id}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-md transition-opacity hover:opacity-70 disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--surface)",
                          border: "1px solid var(--border)",
                          color: "var(--text)",
                        }}
                      >
                        {!a.locked ? "Khoá" : "Mở khoá"}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {(filtered.length === 0 || loading) && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: "var(--muted)" }}
                >
                  {loading ? "Đang tải…" : "Không tìm thấy tài khoản nào."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
