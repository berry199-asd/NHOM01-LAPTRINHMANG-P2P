/**
 * Hook hỗ trợ kéo thả tự do, kẹp trong khung nhìn (clamp), hít cạnh (snap),
 * lưu vị trí vào localStorage (nếu có storageKey), và phân biệt kéo vs nhấp bằng ngưỡng threshold.
 */
import { useEffect, useRef, useState, useCallback } from "react"

export interface DragPosition {
  x: number
  y: number
}

export interface UseDraggableOptions {
  storageKey?: string
  defaultPos: DragPosition | (() => DragPosition)
  snapPadding?: number
  threshold?: number // pixel tối thiểu để tính là đang kéo (tránh nuốt click)
  onDragEnd?: (pos: DragPosition) => void
}

export function clampCoord(
  val: number,
  min: number,
  max: number
): number {
  if (max < min) return min
  return Math.min(Math.max(val, min), max)
}

export function calculateSnap(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportW: number,
  viewportH: number,
  snapPadding: number = 12
): DragPosition {
  const minX = snapPadding
  const maxX = Math.max(minX, viewportW - width - snapPadding)
  const minY = snapPadding
  const maxY = Math.max(minY, viewportH - height - snapPadding)

  let clampedX = clampCoord(x, minX, maxX)
  const clampedY = clampCoord(y, minY, maxY)

  // Snap cạnh trái/phải nếu khoảng cách tới mép nhỏ hơn hoặc bằng 36px
  const snapDist = 36
  if (clampedX - minX <= snapDist) {
    clampedX = minX
  } else if (maxX - clampedX <= snapDist) {
    clampedX = maxX
  }

  return { x: clampedX, y: clampedY }
}

export function readPersistedPos(key: string, fallback: DragPosition): DragPosition {
  try {
    if (typeof window === "undefined" || !window.localStorage) return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number" &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y }
    }
  } catch {
    /* fallback khi localStorage lỗi hoặc bị chặn */
  }
  return fallback
}

export function writePersistedPos(key: string, pos: DragPosition): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(key, JSON.stringify(pos))
    }
  } catch {
    /* bỏ qua lỗi lưu trữ */
  }
}

export function useDraggable({
  storageKey,
  defaultPos,
  snapPadding = 12,
  threshold = 4,
  onDragEnd,
}: UseDraggableOptions) {
  const initialPos = useCallback((): DragPosition => {
    const def = typeof defaultPos === "function" ? defaultPos() : defaultPos
    if (storageKey) {
      return readPersistedPos(storageKey, def)
    }
    return def
  }, [defaultPos, storageKey])

  const [position, setPosition] = useState<DragPosition>(initialPos)
  const [isDragging, setIsDragging] = useState(false)
  const elementRef = useRef<HTMLDivElement | null>(null)

  // Lưu trạng thái thao tác con trỏ
  const dragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
    activePointerId: number | null
    moved: boolean
  }>({
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    activePointerId: null,
    moved: false,
  })

  // Đổi kích thước cửa sổ: kẹp lại vị trí để không bị lọt ra ngoài màn hình
  useEffect(() => {
    const handleResize = () => {
      if (typeof window === "undefined") return
      setPosition((prev) => {
        const el = elementRef.current
        const w = el ? el.offsetWidth : 128
        const h = el ? el.offsetHeight : 176
        const clamped = calculateSnap(
          prev.x,
          prev.y,
          w,
          h,
          window.innerWidth,
          window.innerHeight,
          snapPadding
        )
        if (clamped.x !== prev.x || clamped.y !== prev.y) {
          if (storageKey) writePersistedPos(storageKey, clamped)
          return clamped
        }
        return prev
      })
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [snapPadding, storageKey])

  // Lắng nghe pointer move & up toàn cục khi đang kéo
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const state = dragRef.current
      if (state.activePointerId === null || e.pointerId !== state.activePointerId) return

      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY

      if (!state.moved && Math.hypot(dx, dy) >= threshold) {
        state.moved = true
        setIsDragging(true)
      }

      if (state.moved) {
        e.preventDefault()
        const el = elementRef.current
        const w = el ? el.offsetWidth : 128
        const h = el ? el.offsetHeight : 176

        const nextX = state.origX + dx
        const nextY = state.origY + dy

        const vw = typeof window !== "undefined" ? window.innerWidth : 1024
        const vh = typeof window !== "undefined" ? window.innerHeight : 768

        const clamped = calculateSnap(nextX, nextY, w, h, vw, vh, snapPadding)
        setPosition(clamped)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const state = dragRef.current
      if (state.activePointerId === null || e.pointerId !== state.activePointerId) return

      // Giải phóng con trỏ đã bắt (pointer capture)
      try {
        if (elementRef.current && elementRef.current.hasPointerCapture(e.pointerId)) {
          elementRef.current.releasePointerCapture(e.pointerId)
        }
      } catch {
        /* ignore */
      }

      state.activePointerId = null
      if (state.moved) {
        setIsDragging(false)
        setPosition((finalPos) => {
          if (storageKey) writePersistedPos(storageKey, finalPos)
          onDragEnd?.(finalPos)
          return finalPos
        })
      }
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false })
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerUp)

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerUp)
    }
  }, [snapPadding, threshold, storageKey, onDragEnd])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Chỉ nhận chuột trái hoặc cảm ứng chạm
      if (e.button !== 0) return

      // Không kéo nếu người dùng nhấp vào các nút hoặc phần tử có data-no-drag
      const target = e.target as HTMLElement | null
      if (
        target?.closest("[data-no-drag]")
      ) {
        return
      }

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: position.x,
        origY: position.y,
        activePointerId: e.pointerId,
        moved: false,
      }
    },
    [position]
  )

  return {
    position,
    setPosition,
    isDragging,
    elementRef,
    handlePointerDown,
  }
}
