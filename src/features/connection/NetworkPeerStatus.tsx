import { otherAccountLabel } from "../../lib/peer"
import { isDebugMode } from "../../lib/debugMode"

interface NetworkPeerStatusProps {
  peerState: "off" | "scanning" | "unbound" | "binding" | "on" | "other_account" | "no_core"
  noFreeCore: boolean
  otherPeer: { port: number; username: string } | null
  net: "good" | "weak" | "down"
  serverRealtime: boolean
  netBannerTitle: string
  probeReasonText: string
  serverReasonText: string
  peerPort: number
  peerStatusLabel: string
  e2eState: "locked" | "unlocking" | "unlocked" | "error" | "no_keystore"
  onReleasePeer: () => void
  onApplyStun: () => void
  onToggleE2e: () => void
  onRequestChangePassphrase: () => void
  onRequestResetKeystore: () => void
}

export function NetworkPeerStatus({
  peerState,
  noFreeCore,
  otherPeer,
  net,
  serverRealtime,
  netBannerTitle,
  probeReasonText,
  serverReasonText,
  peerPort,
  peerStatusLabel,
  e2eState,
  onReleasePeer,
  onApplyStun,
  onToggleE2e,
  onRequestChangePassphrase,
  onRequestResetKeystore,
}: NetworkPeerStatusProps) {
  return (
    <>
      {/* Banner: chưa thấy Peer Core / đang gắn tài khoản khác */}
      {peerState === "no_core" && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 rounded-full text-[12px] font-medium shadow-lg"
          style={{
            backgroundColor: "#7c2d12",
            color: "#fed7aa",
            border: "1px solid #9a3412",
          }}
        >
          Chưa thấy Peer Core — hãy bật Peer Core (chạy start-peercore.bat)
        </div>
      )}
      {peerState === "other_account" && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium shadow-lg"
          style={{
            backgroundColor: "#78350f",
            color: "#fde68a",
            border: "1px solid #92400e",
          }}
        >
          <span>{otherAccountLabel(noFreeCore, otherPeer?.username)}</span>
          <button
            onClick={onReleasePeer}
            className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
            style={{ backgroundColor: "#f59e0b", color: "#1f2937" }}
            title="Gỡ gắn Peer Core này và dùng lại cho tài khoản đang đăng nhập"
          >
            Giải phóng và dùng lại
          </button>
        </div>
      )}

      {/* Banner chất lượng mạng: chỉ kênh thời gian thực (WS) tới Tracker gián đoạn */}
      {peerState === "on" && net === "weak" && !serverRealtime && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 rounded-full text-[12px] font-medium shadow-lg"
          style={{
            backgroundColor: "#164e63",
            color: "#a5f3fc",
            border: "1px solid #155e75",
          }}
          title={netBannerTitle}
        >
          Thời gian thực bị gián đoạn, đang thử lại — tin vẫn được gửi
        </div>
      )}

      {/* Banner chất lượng mạng: Mạng yếu */}
      {peerState === "on" && net === "weak" && serverRealtime && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 rounded-full text-[12px] font-medium shadow-lg"
          style={{
            backgroundColor: "#78350f",
            color: "#fde68a",
            border: "1px solid #92400e",
          }}
          title={netBannerTitle}
        >
          Mạng yếu — tin nhắn có thể chậm, sẽ tự gửi lại khi thông suốt
        </div>
      )}

      {peerState === "on" && net === "down" && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] px-3 py-1.5 rounded-full text-[12px] font-medium shadow-lg"
          style={{
            backgroundColor: "#7f1d1d",
            color: "#fecaca",
            border: "1px solid #991b1b",
          }}
          title={[probeReasonText, serverReasonText].filter(Boolean).join(" — ")}
        >
          Mất kết nối — tin nhắn sẽ được gửi khi có mạng trở lại
        </div>
      )}

      {/* Peer Core local (GĐ6/M3): trạng thái gắn + mã hoá đầu-cuối - CHỈ hiện khi có ?debug=1 hoặc workchat.debug=1 */}
      {isDebugMode() && (
        <div
          className="fixed top-14 right-3 z-[70] flex items-center gap-1.5 p-1 rounded-2xl bg-black/40 backdrop-blur-sm pointer-events-auto"
          style={{ maxWidth: "calc(100vw - 24px)" }}
        >
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium shadow-md"
            style={{
              backgroundColor: "var(--panel, #1f2937)",
              color: "var(--text, #e5e7eb)",
              border: `1px solid var(--border, #374151)`,
            }}
            title={peerStatusLabel}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor:
                  peerState === "on"
                    ? "#22c55e"
                    : peerState === "scanning" || peerState === "binding"
                      ? "#f59e0b"
                      : "#ef4444",
              }}
            />
            {peerState === "on" ? `127.0.0.1:${peerPort}` : "Peer Core"} ·{" "}
            {peerStatusLabel}
          </div>

          <button
            onClick={onApplyStun}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium shadow-md"
            style={{
              backgroundColor: "var(--panel, #1f2937)",
              color: "var(--text, #e5e7eb)",
              border: `1px solid var(--border, #374151)`,
            }}
            title="Cấu hình máy chủ STUN cho Peer Core"
          >
            STUN
          </button>

          <button
            onClick={onToggleE2e}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium shadow-md"
            style={{
              backgroundColor: "var(--panel, #1f2937)",
              color: "var(--text, #e5e7eb)",
              border: `1px solid var(--border, #374151)`,
            }}
            title="Mã hoá đầu-cuối: nhấn để mở khoá hoặc khoá"
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor:
                  e2eState === "unlocked"
                    ? "#22c55e"
                    : e2eState === "unlocking"
                      ? "#f59e0b"
                      : e2eState === "error"
                        ? "#ef4444"
                        : "#6b7280",
              }}
            />
            E2E{" "}
            {e2eState === "unlocked"
              ? "• đã mở"
              : e2eState === "unlocking"
                ? "• đang mở…"
                : e2eState === "error"
                  ? "• lỗi"
                  : e2eState === "no_keystore"
                    ? "• chưa có khoá"
                    : "• đang khoá"}
          </button>

          {e2eState === "unlocked" && (
            <button
              onClick={onRequestChangePassphrase}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium shadow-md"
              style={{
                backgroundColor: "var(--panel, #1f2937)",
                color: "var(--text, #e5e7eb)",
                border: `1px solid var(--border, #374151)`,
              }}
              title="Đổi mật khẩu bảo vệ khoá E2E"
            >
              Đổi MK
            </button>
          )}

          {e2eState === "error" && (
            <button
              onClick={onRequestResetKeystore}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium shadow-md"
              style={{
                backgroundColor: "var(--panel, #1f2937)",
                color: "#fca5a5",
                border: `1px solid var(--border, #374151)`,
              }}
              title="Quên mật khẩu E2E? Xoá khoá và tạo khoá mới"
            >
              Quên MK
            </button>
          )}
        </div>
      )}
    </>
  )
}
