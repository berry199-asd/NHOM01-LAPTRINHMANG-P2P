import { fmtDuration } from "../bubbles/QuoteBlock"

export interface MediaPreviewItem {
  name: string
  size: number
  url: string
  kind: "image" | "video"
  duration?: number
}

export interface MediaPreviewModalProps {
  mediaPreview: MediaPreviewItem[] | null
  previewPlayUrl: string | null
  setPreviewPlayUrl: (url: string | null) => void
  onCancel: () => void
  onConfirm: () => void
}

export function MediaPreviewModal({
  mediaPreview,
  previewPlayUrl,
  setPreviewPlayUrl,
  onCancel,
  onConfirm,
}: MediaPreviewModalProps) {
  if (!mediaPreview) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="w-full max-w-md rounded-xl overflow-hidden shadow-xl"
        style={{
          backgroundColor: "var(--bg)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h3
            className="text-sm font-semibold"
            style={{ color: "var(--text)" }}
          >
            {mediaPreview.some((p) => p.kind === "video")
              ? `Xem trước (${mediaPreview.filter((p) => p.kind === "image").length} ảnh, ${mediaPreview.filter((p) => p.kind === "video").length} video)`
              : `Xem trước ảnh (${mediaPreview.length})`}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--muted)" }}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto p-4 grid grid-cols-3 gap-2">
          {mediaPreview.map((img, i) => (
            <div
              key={i}
              className="relative group rounded-lg overflow-hidden"
              style={{ border: "1px solid var(--border)" }}
            >
              {img.kind === "video" ? (
                previewPlayUrl === img.url ? (
                  <video
                    src={img.url}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-24 object-contain"
                    style={{ backgroundColor: "#000" }}
                  />
                ) : (
                  <button
                    type="button"
                    className="relative block w-full"
                    onClick={() => setPreviewPlayUrl(img.url)}
                    title="Phát thử"
                  >
                    <video
                      src={`${img.url}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                      className="w-full h-24 object-cover"
                    />
                    <span
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ pointerEvents: "none" }}
                    >
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="#fff"
                          style={{ marginLeft: 1 }}
                        >
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </span>
                    </span>
                    {img.duration ? (
                      <span
                        className="absolute right-1 bottom-1 px-1 py-px rounded"
                        style={{
                          backgroundColor: "rgba(0,0,0,0.7)",
                          color: "#fff",
                        }}
                      >
                        <span className="text-[9px] font-semibold">
                          {fmtDuration(img.duration)}
                        </span>
                      </span>
                    ) : null}
                  </button>
                )
              ) : (
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full h-24 object-cover"
                />
              )}
              {previewPlayUrl !== img.url && (
                <div
                  className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[10px] truncate"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.55)",
                    color: "#fff",
                  }}
                >
                  {img.name}
                </div>
              )}
            </div>
          ))}
        </div>
        <div
          className="px-4 py-3 flex justify-end gap-2"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <button
            onClick={onCancel}
            className="px-3 py-2 text-sm font-medium rounded-md transition-opacity hover:opacity-70"
            style={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-semibold rounded-md transition-opacity hover:opacity-80"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
            }}
          >
            Gửi {mediaPreview.length}{" "}
            {mediaPreview.some((p) => p.kind === "video")
              ? "ảnh/video"
              : "ảnh"}
          </button>
        </div>
      </div>
    </div>
  )
}
