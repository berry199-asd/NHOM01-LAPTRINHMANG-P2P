import type { ChatFile } from "../types/chat"

export function transferLabel(file: ChatFile) {
  const pct = Math.round(file.progress)
  if (file.state === "cancelled") return "Đã hủy"
  if (file.state === "failed") return "Gửi thất bại"
  if (file.state === "waiting") return "Đang chờ người nhận"
  if (!file.done && pct < 40) return `Mã hoá ${pct}% (PC18)`
  if (!file.done) {
    if (file.state === "sending" && file.weak) return `Đang gửi (mạng yếu) ${pct}%`
    if (file.state === "sending" && pct >= 100) return "Đang gửi tới người nhận"
    const sent = Math.max(1, Math.ceil((pct / 100) * (file.chunks ?? 1)))
    return `TCP P2P: chunk ${sent}/${file.chunks ?? 1} · ${pct}%`
  }
  if (file.total && file.total > 1) return `Đã gửi ${file.sentTo ?? file.total}/${file.total} người nhận`
  return `Đã ghép chunk · checksum ${file.checksum ?? "OK"} ✓`
}
