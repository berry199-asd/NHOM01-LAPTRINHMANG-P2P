export interface RouteMismatchModalProps {
  routeMismatch: string | null
  onSwitch: () => void
  onLogout: () => void
}

export function RouteMismatchModal({
  routeMismatch,
  onSwitch,
  onLogout,
}: RouteMismatchModalProps) {
  if (!routeMismatch) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 shadow-xl"
        style={{
          backgroundColor: "var(--panel, var(--bg))",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          className="text-base font-semibold mb-2"
          style={{ color: "var(--text)" }}
        >
          Khác tài khoản
        </h3>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
          Liên kết này thuộc tài khoản <b>@{routeMismatch}</b>, nhưng bạn đang
          đăng nhập bằng tài khoản khác. Bạn muốn chuyển tài khoản?
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onSwitch}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ border: "1px solid var(--border)", color: "var(--text)" }}
          >
            Chuyển tài khoản
          </button>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg, var(--bg))",
            }}
          >
            Đăng xuất
          </button>
        </div>
      </div>
    </div>
  )
}
