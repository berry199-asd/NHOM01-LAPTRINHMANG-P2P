/**
 * Component ảnh đại diện DUY NHẤT dùng cho toàn app: danh sách hội thoại, danh
 * sách bạn, tiêu đề phòng, hồ sơ, mọi màn hình gọi và thẻ gọi trong dòng tin.
 *
 * Viết bằng `createElement` (không JSX) để **test được** bằng `node --test` +
 * `renderToStaticMarkup` (repo không có jsdom/testing-library).
 *
 * Cấu trúc: một vòng tròn (mang cỡ, nền, viền, bóng, màu chữ) → chữ viết tắt LUÔN
 * nằm dưới + `<img>` phủ lên trên khi có ảnh. Mọi URL đi qua `resolveAvatarUrl`
 * (đường dẫn tương đối cùng origin); ảnh lỗi → rơi về chữ viết tắt.
 */
import {
  createElement,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"
import { resolveAvatarUrl } from "../lib/avatarUrl.ts"
import { initialsOf } from "../lib/callView.ts"

export interface AvatarProps {
  /** Ảnh người (thô); chuẩn hoá bằng `resolveAvatarUrl`. Thiếu/rỗng → chữ đầu. */
  src?: string
  /** Họ tên — dùng khi không truyền `initials`. */
  name?: string
  /** Chữ viết tắt (ghi đè cách suy ra từ `name`). */
  initials?: string
  /** Trạng thái trực tuyến của CHẤM báo. */
  online?: boolean
  /** Chấm trạng thái? Mặc định true (giữ hành vi danh sách); màn hình gọi tắt. */
  showPresence?: boolean
  size?: "sm" | "md"
  ring?: boolean
  /** Cỡ vuông tuỳ ý (màn hình gọi) — khi có thì bỏ class Tailwind. */
  sizePx?: number
  /** Cỡ chữ khi dùng `sizePx`. */
  fontSizePx?: number
  /** Class cho VÒNG TRÒN (màn hình gọi truyền `call-glow`). */
  className?: string
  /** Style cho VÒNG TRÒN (nền/viền/bóng/màu chữ) — ghi đè mặc định. */
  style?: CSSProperties
  alt?: string
  /** Ảnh mờ dần vào (chỉ màn hình gọi): blur-up từ chữ viết tắt → ảnh. */
  blurUp?: boolean
  /** Đánh dấu trang trí (không đọc bằng máy đọc màn hình). */
  ariaHidden?: boolean
  onLoad?: () => void
  onError?: () => void
}

export function Avatar(props: AvatarProps): ReactNode {
  const {
    src,
    name,
    initials,
    online = false,
    showPresence = true,
    size = "md",
    sizePx,
    fontSizePx,
    className,
    style,
    alt,
    blurUp = false,
    ariaHidden = false,
    onLoad,
    onError,
  } = props

  const resolved = resolveAvatarUrl(src)
  const isDataOrBlob = !!resolved && /^(data:|blob:)/i.test(resolved)
  const [errored, setErrored] = useState(false)
  const [loaded, setLoaded] = useState(isDataOrBlob)
  useEffect(() => {
    setErrored(false)
    setLoaded(isDataOrBlob)
  }, [resolved, isDataOrBlob])

  const text = (initials ?? initialsOf(name ?? "")).slice(0, 4) || "?"
  const showImg = !!resolved && !errored

  const sizeClass = sizePx ? "" : size === "sm" ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm"

  const boxStyle: CSSProperties = {
    ...(sizePx
      ? {
          width: sizePx,
          height: sizePx,
          fontSize: fontSizePx ?? Math.max(10, Math.round(sizePx * 0.36)),
        }
      : {}),
    backgroundColor: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    ...style,
  }

  const children: ReactNode[] = [
    createElement(
      "span",
      {
        key: "ini",
        className: "font-semibold select-none truncate px-1",
        "aria-hidden": true,
      },
      text,
    ),
  ]

  if (showImg) {
    children.push(
      createElement("img", {
        key: "img",
        src: resolved,
        alt: alt ?? text,
        className: "absolute inset-0 w-full h-full rounded-full object-cover",
        style: blurUp && !isDataOrBlob
          ? {
              display: "block",
              opacity: loaded ? 1 : 0,
              filter: loaded ? "none" : "blur(14px)",
              transition: loaded ? "filter 320ms ease, opacity 320ms ease" : "none",
            }
          : { display: "block" },
        onLoad: () => {
          setLoaded(true)
          onLoad?.()
        },
        onError: () => {
          setErrored(true)
          onError?.()
        },
      }),
    )
  }

  if (showPresence) {
    children.push(
      createElement("span", {
        key: "dot",
        className: "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2",
        style: {
          backgroundColor: online ? "#22c55e" : "#9ca3af",
          borderColor: "var(--bg)",
        },
      }),
    )
  }

  return createElement(
    "div",
    {
      className:
        `relative flex-shrink-0 rounded-full flex items-center justify-center ${sizeClass} ${className ?? ""}`.trim(),
      style: boxStyle,
      ...(ariaHidden ? { "aria-hidden": true } : {}),
    },
    ...children,
  )
}

export default Avatar
