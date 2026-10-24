import React from "react"
import { downloadFile } from "../bubbles/FileBubble"

export interface LightboxImage {
  id: number
  url: string
  name: string
  size: string
  isVideo?: boolean
  duration?: number
}

export interface MediaLightboxState {
  images: LightboxImage[]
  index: number
}

export interface MediaLightboxModalProps {
  lightbox: MediaLightboxState | null
  setLightbox: React.Dispatch<React.SetStateAction<MediaLightboxState | null>>
  stepLightbox: (delta: number) => void
  thumbStripRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
}

export function MediaLightboxModal({
  lightbox,
  setLightbox,
  stepLightbox,
  thumbStripRef,
  onClose,
}: MediaLightboxModalProps) {
  if (!lightbox) return null

  const cur = lightbox.images[lightbox.index]
  if (!cur) return null
  const multi = lightbox.images.length > 1

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.9)" }}
      onClick={onClose}
    >
      <button
        className="fixed top-4 right-4 p-2 rounded-full transition-opacity hover:opacity-70"
        style={{
          backgroundColor: "rgba(255,255,255,0.15)",
          color: "#fff",
        }}
        onClick={onClose}
        title="Đóng (Esc)"
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
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {multi && (
        <>
          <button
            className="fixed left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full transition-opacity hover:opacity-70"
            style={{
              backgroundColor: "rgba(255,255,255,0.12)",
              color: "#fff",
            }}
            onClick={() => stepLightbox(-1)}
            title="Media trước (←)"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            className="fixed right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full transition-opacity hover:opacity-70"
            style={{
              backgroundColor: "rgba(255,255,255,0.12)",
              color: "#fff",
            }}
            onClick={() => stepLightbox(1)}
            title="Media tiếp (→)"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div
          className="flex flex-col items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {cur.isVideo ? (
            <video
              key={cur.id}
              src={cur.url}
              controls
              playsInline
              className="max-w-[85vw] max-h-[calc(100vh-190px)] rounded-lg shadow-2xl"
              style={{ backgroundColor: "#000" }}
            />
          ) : (
            <img
              src={cur.url}
              alt={cur.name}
              className="max-w-[85vw] max-h-[calc(100vh-190px)] object-contain"
              style={{ backgroundColor: "#000" }}
            />
          )}
          <div className="flex items-center gap-3">
            {multi && (
              <span
                className="text-xs"
                style={{ color: "rgba(255,255,255,0.6)" }}
              >
                {lightbox.index + 1}/{lightbox.images.length}
              </span>
            )}
            <p
              className="text-sm font-medium truncate max-w-[60vw]"
              style={{ color: "#fff" }}
            >
              {cur.name}
            </p>
            <span
              className="text-xs"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              {cur.size}
            </span>
            <button
              onClick={() => downloadFile(cur.url, cur.name)}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-70"
              style={{
                backgroundColor: "rgba(255,255,255,0.15)",
                color: "#fff",
              }}
            >
              Tải xuống
            </button>
          </div>
        </div>
      </div>
      {multi && (
        <div
          className="flex-shrink-0 mt-3 min-h-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={thumbStripRef}
            className="no-scrollbar overflow-x-auto flex items-center gap-2 px-3 py-2.5 rounded-xl"
            style={{
              backgroundColor: "rgba(0,0,0,0.96)",
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {lightbox.images.map((im, idx) => (
              <button
                key={im.id}
                data-active={idx === lightbox.index ? "true" : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  setLightbox((lb) => (lb ? { ...lb, index: idx } : lb))
                }}
                className={`relative w-11 h-11 sm:w-14 sm:h-14 flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
                  idx === lightbox.index
                    ? "opacity-100"
                    : "opacity-60 hover:opacity-100"
                }`}
                style={{
                  borderColor:
                    idx === lightbox.index ? "#fff" : "transparent",
                }}
                title={im.name}
              >
                {im.isVideo ? (
                  <video
                    src={`${im.url}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={im.url}
                    alt={im.name}
                    className="w-full h-full object-cover"
                  />
                )}
                {im.isVideo && (
                  <span
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ pointerEvents: "none" }}
                  >
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="#fff"
                        style={{ marginLeft: 1 }}
                      >
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
