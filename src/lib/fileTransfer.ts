import type { ChatFile } from "../types/chat"

export function transferLabel(file: ChatFile) {
  const pct = Math.round(file.progress)
  if (file.state === "cancelled") return "Đã hủy"
  if (file.state === "failed") return "Gửi thất bại"
  if (file.state === "waiting") return "Đang chờ người nhận"
  if (!file.done) {
    if (file.state === "sending" && file.weak) return `Đang gửi (mạng yếu) ${pct}%`
    if (file.state === "sending" && pct >= 100) return "Đang hoàn tất gửi…"
    if (pct <= 8) return `Đang chuẩn bị truyền: ${pct}%`
    const sent = Math.max(1, Math.min(file.chunks ?? 1, Math.ceil((pct / 100) * (file.chunks ?? 1))))
    return `Đang truyền P2P: chunk ${sent}/${file.chunks ?? 1} · ${pct}%`
  }
  if (file.total && file.total > 1) return `Đã gửi ${file.sentTo ?? file.total}/${file.total} người nhận`
  return `Đã gửi · checksum ${file.checksum ?? "OK"} ✓`
}
