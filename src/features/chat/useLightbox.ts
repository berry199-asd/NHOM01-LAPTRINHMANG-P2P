import { useState, useRef, useEffect } from "react"
import type { Conversation } from "../../types/chat"

export interface LightboxData {
  images: {
    id: number
    url: string
    name: string
    size: string
    isVideo?: boolean
    duration?: number
  }[]
  index: number
}

export function useLightbox(selected: Conversation) {
  const [lightbox, setLightbox] = useState<LightboxData | null>(null)
  const thumbStripRef = useRef<HTMLDivElement>(null)

  const openLightbox = (msgId: number) => {
    const images = selected.messages
      .filter(
        (m) =>
          m.file &&
          (m.file.isImage || m.file.isVideo) &&
          m.file.url &&
          m.file.done,
      )
      .map((m) => ({
        id: m.id,
        url: m.file!.url!,
        name: m.file!.name,
        size: m.file!.size,
        isVideo: m.file!.isVideo ?? false,
        duration: m.file!.duration,
      }))
    const index = Math.max(
      0,
      images.findIndex((im) => im.id === msgId),
    )
    setLightbox({ images, index })
  }

  const stepLightbox = (dir: number) =>
    setLightbox((lb) =>
      lb && lb.images.length > 1
        ? {
            ...lb,
            index: (lb.index + (dir > 0 ? 1 : -1) + lb.images.length) % lb.images.length,
          }
        : lb,
    )

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null)
      if (e.key === "ArrowLeft") stepLightbox(-1)
      if (e.key === "ArrowRight") stepLightbox(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightbox])

  useEffect(() => {
    if (!lightbox) return
    const c = thumbStripRef.current
    if (!c) return
    const active = c.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return
    const target =
      active.offsetLeft - c.clientWidth / 2 + active.clientWidth / 2
    c.scrollTo({ left: Math.max(0, target), behavior: "smooth" })
  }, [lightbox])

  return {
    lightbox,
    setLightbox,
    thumbStripRef,
    openLightbox,
    stepLightbox,
  }
}
