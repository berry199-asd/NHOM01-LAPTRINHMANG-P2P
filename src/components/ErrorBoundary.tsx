import React, { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
          style={{ backgroundColor: "var(--bg, #0f172a)", color: "var(--text, #f8fafc)" }}
        >
          <div className="w-16 h-16 mb-4 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-2xl font-bold">
            !
          </div>
          <h2 className="text-xl font-bold mb-2">Đã xảy ra sự cố hiển thị</h2>
          <p className="text-sm opacity-70 mb-6 max-w-md">
            Trang web gặp sự cố không mong muốn ({this.state.error?.message || "Lỗi giao diện"}). Bạn có thể tải lại trang để tiếp tục.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition-colors cursor-pointer"
            >
              Tải lại trang
            </button>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.href = "/"
              }}
              className="px-4 py-2 rounded-lg bg-white/10 text-white/80 font-medium hover:bg-white/20 transition-colors cursor-pointer"
            >
              Về trang chủ
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
