import { AuthLayout } from "../components/AuthLayout"

interface Props {
  onLogin: () => void
}

export function RegisterSuccess({ onLogin }: Props) {
  return (
    <AuthLayout>
      <div className="flex flex-col items-center text-center gap-6 py-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ border: "2px solid var(--primary)" }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--primary)" }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <div>
          <h1
            className="text-xl font-semibold mb-2"
            style={{ color: "var(--text)" }}
          >
            Đăng ký thành công!
          </h1>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Tài khoản của bạn đã được tạo.
            <br />
            Bạn có thể đăng nhập ngay bây giờ.
          </p>
        </div>

        <button
          onClick={onLogin}
          className="w-full py-2.5 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
          style={{
            backgroundColor: "var(--primary)",
            color: "var(--primary-fg)",
          }}
        >
          Về đăng nhập
        </button>
      </div>
    </AuthLayout>
  )
}
