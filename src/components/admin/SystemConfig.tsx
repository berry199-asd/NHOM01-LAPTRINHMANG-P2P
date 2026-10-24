import { useCallback, useEffect, useState } from "react"
import { api } from "../../lib/api"

interface Field {
  key: string
  label: string
  unit: string
  hint: string
  min: number
  max: number
  fallback: number
}

const FIELDS: Field[] = [
  {
    key: "max_file_size_mb",
    label: "Dung lượng file tối đa",
    unit: "MB",
    hint: "",
    min: 1,
    max: 2048,
    fallback: 25,
  },
  {
    key: "heartbeat_timeout_sec",
    label: "Heartbeat Timeout",
    unit: "giây",
    hint: "Thời gian tối đa chờ phản hồi heartbeat trước khi coi peer là ngoại tuyến.",
    min: 5,
    max: 300,
    fallback: 30,
  },
  {
    key: "max_login_attempts",
    label: "Số lần đăng nhập sai tối đa",
    unit: "lần",
    hint: "Số lần sai liên tiếp trước khi tạm khoá tài khoản.",
    min: 1,
    max: 20,
    fallback: 5,
  },
  {
    key: "max_room_members",
    label: "Số thành viên tối đa mỗi phòng",
    unit: "người",
    hint: "Bao gồm cả người tạo phòng.",
    min: 2,
    max: 1000,
    fallback: 20,
  },
]

export function SystemConfig() {
  const [values, setValues] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await api.adminConfig()
    setLoading(false)
    if (!r.ok) {
      setError(
        r.error === "forbidden"
          ? "Tài khoản không có quyền quản trị."
          : "Không tải được cấu hình hệ thống.",
      )
      return
    }
    const map: Record<string, number> = {}
    for (const f of FIELDS) {
      const found = (r.data?.config ?? []).find((c) => c.key === f.key)
      const n = found?.value != null ? Number(found.value) : NaN
      map[f.key] = Number.isFinite(n) ? n : f.fallback
    }
    setValues(map)
    setError("")
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setError("")
    for (const f of FIELDS) {
      const v = Math.min(f.max, Math.max(f.min, Math.round(values[f.key] ?? f.fallback)))
      const r = await api.adminSetConfig(f.key, String(v))
      if (!r.ok) {
        setSaving(false)
        setError("Không lưu được cấu hình. Vui lòng thử lại.")
        return
      }
    }
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 4000)
  }

  return (
    <div className="max-w-md">
      <div className="flex flex-col gap-4">
        {error && (
          <p className="text-sm" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}

        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label
              className="text-sm font-medium"
              style={{ color: "var(--text)" }}
            >
              {f.label}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={f.min}
                max={f.max}
                disabled={loading || saving}
                value={values[f.key] ?? f.fallback}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [f.key]: Number(e.target.value),
                  }))
                }
                className="w-32 px-3 py-2.5 text-sm rounded-md outline-none disabled:opacity-50"
                style={{
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
              <span className="text-sm" style={{ color: "var(--muted)" }}>
                {f.unit}
              </span>
            </div>
            {f.hint && (
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                {f.hint}
              </p>
            )}
          </div>
        ))}

        <button
          onClick={save}
          disabled={loading || saving}
          className="w-32 py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
          }}
        >
          {saving ? "Đang lưu…" : "Lưu cấu hình"}
        </button>

        {saved && (
          <div
            className="flex items-center gap-2 rounded-lg px-4 py-3"
            style={{
              backgroundColor: "#ecfdf5",
              border: "1px solid #a7f3d0",
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: "#16a34a" }}
            />
            <p className="text-sm" style={{ color: "#065f46" }}>
              Cấu hình đã được lưu.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
