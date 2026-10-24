import { useState, useEffect } from "react"
import type { Message, ChatFile } from "../../../types/chat"
import { readVideoMeta, fmtDuration } from "./QuoteBlock"
import { validateFileExtension } from "../../../lib/fileValidator"

export function transferLabel(file: ChatFile) {
  const pct = Math.round(file.progress)
  if (file.state === "cancelled") return "Đã hủy"
  if (file.state === "failed") return "Gửi thất bại"
  if (file.state === "waiting") return "Đang chờ người nhận"
  if (!file.done && file.state !== "failed" && pct < 40) return `Mã hoá ${pct}% (PC18)`
  if (!file.done) {
    if (file.state === "sending" && file.weak) return `Đang gửi (mạng yếu) ${pct}%`
    if (file.state === "sending" && pct >= 100) return "Đang gửi tới người nhận"
    const sent = Math.max(1, Math.ceil((pct / 100) * (file.chunks ?? 1)))
    return `TCP P2P: chunk ${sent}/${file.chunks ?? 1} · ${pct}%`
  }
  if (file.total && file.total > 1) return `Đã gửi ${file.sentTo ?? file.total}/${file.total} người nhận`
  return `Đã ghép chunk · checksum ${file.checksum ?? "OK"} ✓`
}

export function FileBubble({
  msg,
  fromMe,
  onOpenImage,
  onDownload,
  onCancel,
  onRetry,
}: {
  msg: Message
  fromMe?: boolean
  onOpenImage?: (msgId: number) => void
  /** Tải tệp qua vé một lần của Core (khi chưa có `url` blob cục bộ). */
  onDownload?: () => void
  /** Hủy tệp đang gửi/nhận (Core sẽ gửi `file_cancel`). */
  onCancel?: () => void
  /** Gửi lại tệp đã hủy/lỗi từ dữ liệu Core còn giữ. */
  onRetry?: () => void
}) {
  const file = msg.file
  if (!file) return null
  const isSvg = (file.name || "").toLowerCase().endsWith(".svg")
  if (file.isImage && file.url && !isSvg) {
    return (
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: "#111",
          maxWidth: 260,
          width: "fit-content",
          cursor: file.done ? "pointer" : "default",
        }}
        onClick={() =>
          file.done && msg.id !== undefined && onOpenImage?.(msg.id)
        }
      >
        {/* Image centered, keep aspect ratio, contain — dark letterbox everywhere */}
        <div
          className="flex items-center justify-center"
          style={{ minHeight: 0 }}
        >
          <img
            src={file.url}
            alt={file.name}
            className="block"
            style={{
              width: "auto",
              height: "auto",
              maxWidth: 260,
              maxHeight: 280,
              objectFit: "contain",
            }}
          />
        </div>
        {/* Status overlaid on the image corner, inside the frame */}
        {!file.done && (
          <div
            className="absolute top-1.5 right-1.5 flex items-center gap-1.5 px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#fff" }}
          >
            <span className="text-[10px] font-semibold">
              {Math.round(file.progress)}%
            </span>
            <div
              className="w-10 h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.25)" }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${file.progress}%`, backgroundColor: "#fff" }}
              />
            </div>
          </div>
        )}
        {file.done && (
          <div
            className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[10px] font-medium">Đã gửi</span>
          </div>
        )}
        {/* Dark caption frame — no white anywhere */}
        <div
          className="px-2.5 py-1.5 flex flex-col gap-0.5"
          style={{ backgroundColor: "#111" }}
        >
          <p
            className="text-[11px] truncate"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            {file.name} · {file.size}
          </p>
          <p
            className="text-[10px] truncate"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            {transferLabel(file)}
          </p>
        </div>
      </div>
    )
  }
  if (file.isVideo && file.url) {
    return (
      <div
        className="relative overflow-hidden rounded-xl"
        style={{
          backgroundColor: "#111",
          maxWidth: 260,
          width: "fit-content",
          cursor: file.done ? "pointer" : "default",
        }}
        onClick={() =>
          file.done && msg.id !== undefined && onOpenImage?.(msg.id)
        }
      >
        <div
          className="flex items-center justify-center relative"
          style={{ minHeight: 0 }}
        >
          <video
            src={`${file.url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            className="block"
            style={{
              width: "auto",
              height: "auto",
              maxWidth: 260,
              maxHeight: 280,
              objectFit: "contain",
              backgroundColor: "#000",
            }}
          />
          {file.done && (
            <span
              className="absolute inset-0 flex items-center justify-center"
              style={{ pointerEvents: "none" }}
            >
              <span
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="#fff"
                  style={{ marginLeft: 2 }}
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </span>
            </span>
          )}
          {file.done && file.duration ? (
            <span
              className="absolute right-1.5 bottom-1.5 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "rgba(0,0,0,0.7)", color: "#fff" }}
            >
              <span className="text-[10px] font-semibold">
                {fmtDuration(file.duration)}
              </span>
            </span>
          ) : null}
        </div>
        {/* Status overlaid on the video frame corner */}
        {!file.done && (
          <div
            className="absolute top-1.5 right-1.5 flex items-center gap-1.5 px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#fff" }}
          >
            <span className="text-[10px] font-semibold">
              {Math.round(file.progress)}%
            </span>
            <div
              className="w-10 h-1 rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.25)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${file.progress}%`,
                  backgroundColor: "#fff",
                }}
              />
            </div>
          </div>
        )}
        {file.done && (
          <div
            className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md"
            style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[10px] font-medium">Đã gửi</span>
          </div>
        )}
        {/* Dark caption frame */}
        <div
          className="px-2.5 py-1.5 flex flex-col gap-0.5"
          style={{ backgroundColor: "#111" }}
        >
          <p
            className="text-[11px] truncate"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            {file.name} · {file.size}
          </p>
          <p
            className="text-[10px] truncate"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            {transferLabel(file)}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 min-w-[220px]">
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: fromMe ? "rgba(255,255,255,0.15)" : "var(--surface)",
          border: `1px solid ${
            fromMe ? "rgba(255,255,255,0.25)" : "var(--border)"
          }`,
          color: fromMe ? "var(--primary-fg)" : "var(--muted)",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file?.name}</p>
        {file && !file.done && (
          <>
            <p className="text-xs mt-0.5" style={{ opacity: 0.8 }}>
              {file.size} · {Math.round(file.progress)}%
            </p>
            <div
              className="w-full h-1.5 rounded-full mt-1.5 overflow-hidden"
              style={{
                backgroundColor: fromMe
                  ? "rgba(255,255,255,0.2)"
                  : "var(--border)",
              }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${file.progress}%`,
                  backgroundColor: fromMe
                    ? "var(--primary-fg)"
                    : "var(--primary)",
                }}
              />
            </div>
          </>
        )}
        {file && file.done && (
          <p className="text-xs mt-0.5" style={{ opacity: 0.8 }}>
            {file.size}
          </p>
        )}
      <p className="text-[10px] mt-1" style={{ opacity: 0.7 }}>
        {transferLabel(file)}
      </p>
      {file?.name && validateFileExtension(file.name).warnSender && (
        <p className="text-[10px] font-medium mt-0.5" style={{ color: fromMe ? "rgba(255,255,255,0.9)" : "#d97706" }}>
          ⚠️ Chỉ mở nếu tin người gửi
        </p>
      )}
      {fromMe && !file.done && (
        <div className="mt-1 flex items-center gap-3">
          {file.state !== "failed" && file.state !== "cancelled" && (
            <button
              onClick={() => onCancel?.()}
              className="text-[10px] underline"
              style={{ color: fromMe ? "var(--primary-fg)" : "var(--muted)" }}
            >
              Hủy
            </button>
          )}
          {(file.state === "failed" || file.state === "cancelled") && (
            <button
              onClick={() => onRetry?.()}
              className="text-[10px] underline"
              style={{ color: fromMe ? "var(--primary-fg)" : "var(--muted)" }}
            >
              Thử lại
            </button>
          )}
        </div>
      )}
    </div>
      {file?.done && (
        <button
          onClick={() => (onDownload ? onDownload() : downloadFile(file.url, file.name))}
          className="p-1.5 rounded-md flex-shrink-0 transition-opacity hover:opacity-70"
          style={{ color: fromMe ? "var(--primary-fg)" : "var(--muted)" }}
          title="Tải xuống"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      )}
    </div>
  )
}

export async function downloadFile(url: string | undefined, name: string) {
  if (!url) return
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objectUrl
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch {
    // URL không còn hiệu lực — bỏ qua
  }
}
