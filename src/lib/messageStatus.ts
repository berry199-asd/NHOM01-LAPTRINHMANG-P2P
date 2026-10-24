/**
 * Nhãn/màu trạng thái gửi hiển thị cạnh tin của mình.
 *
 * Trạng thái "stored" nghĩa là phong bì đang nằm trong outbox/hộp thư chờ gửi (mất mạng
 * hoặc người nhận offline) — TUYỆT ĐỐI không được hiển thị "Đã gửi".
 */
export type MessageStatus =
  | "sent"
  | "delivered"
  | "seen"
  | "sending"
  | "stored"
  | "failed"

export function ackLabel(status: MessageStatus | undefined): string {
  switch (status) {
    case "delivered":
      return "Đã nhận"
    case "seen":
      return "Đã xem"
    case "sending":
      return "Đang gửi…"
    case "failed":
      return "Gửi lỗi"
    case "stored":
      return "Đang chờ"
    default:
      return "Đã gửi"
  }
}

export function ackColor(status: MessageStatus | undefined): string {
  switch (status) {
    case "seen":
      return "#38bdf8"
    case "delivered":
      return "#94a3b8"
    case "failed":
      return "#ef4444"
    case "stored":
      return "#f59e0b"
    default:
      return "var(--muted)"
  }
}
