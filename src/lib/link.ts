export type InviteTarget =
  | { type: "user"; publicId: string }
  | { type: "room"; code: string }

const TOKEN_RE = /^[0-9A-Za-z]{6,32}$/
const USER_PATH_RE = /^\/?u\/([0-9A-Za-z_-]{1,128})\/?$/i
const ROOM_PATH_RE = /^\/?r\/([0-9A-Za-z_-]{1,128})\/?$/i

/**
 * Bóc tách mã kết bạn / mã phòng từ nhiều dạng input:
 * - link đầy đủ: https://any-host.dev/u/AbCd123456 hoặc /r/xxxx
 * - link thiếu scheme: u/AbCd123456, /r/xxxx
 * - publicId trần: AbCd123456 (coi như mã người dùng)
 * Không so khớp domain chặt (mặc định cho phép mọi host), chỉ cần path /u/ hoặc /r/ hợp lệ.
 * Chuỗi rác / path sai → null (rơi xuống tìm kiếm thông thường).
 */
export function parseAnyLink(input: string): InviteTarget | null {
  const raw = (input ?? "").trim()
  if (!raw) return null

  const cleaned = raw.replace(/[)\]}>'"]+$/, "")

  // Có scheme (http:/https:/app:/...) → đọc từ URL
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) {
    try {
      const u = new URL(cleaned)
      const seg = decodePath(u.pathname)
      return matchPathSegments(seg)
    } catch {
      return null
    }
  }

  return matchPathSegments(cleaned)
}

function decodePath(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

function matchPathSegments(path: string): InviteTarget | null {
  const clean = path.trim().split(/[?#]/)[0]
  if (!clean) return null

  const user = USER_PATH_RE.exec(clean)
  if (user) {
    const token = user[1]
    if (TOKEN_RE.test(token)) return { type: "user", publicId: token }
    return null
  }

  const room = ROOM_PATH_RE.exec(clean)
  if (room) {
    const token = room[1]
    if (TOKEN_RE.test(token)) return { type: "room", code: token }
    return null
  }

  // publicId trần (không kèm đường dẫn)
  if (TOKEN_RE.test(clean)) {
    return { type: "user", publicId: clean }
  }

  return null
}

/** Gốc ứng dụng từ VITE_APP_URL (hoặc origin trình duyệt khi dev). */
export function appBaseUrl(): string {
  const envUrl = import.meta.env?.VITE_APP_URL as string | undefined
  if (envUrl && envUrl.trim()) {
    try {
      const u = new URL(envUrl)
      return (u.origin + u.pathname.replace(/\/+$/, "")).replace(/\/$/, "")
    } catch {
      // fallthrough về window origin
    }
  }
  if (typeof window !== "undefined") {
    return window.location.origin
  }
  return ""
}

export function buildUserLink(publicId: string): string {
  return `${appBaseUrl()}/u/${encodeURIComponent(publicId)}`
}

export function buildRoomLink(code: string): string {
  return `${appBaseUrl()}/r/${encodeURIComponent(code)}`
}

// ---------------------------------------------------------------------------
// Định tuyến theo tài khoản: /@<public_id> và /@<public_id>/c/<roomId>
// (trước đây là /@<username>; nay dùng public_id để không lộ username)
// ---------------------------------------------------------------------------

/**
 * Khớp đúng quy tắc username của backend (HttpRestHandler.USERNAME_RE =
 * "^[a-zA-Z0-9_.\\-]{3,32}$"). Giữ để tương thích ngược các link /@<username> cũ.
 */
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/

export type FriendsTab = "requests" | "sent" | "suggestions" | "all" | "blocked"

export type AppRoute =
  | { kind: "root" }
  | { kind: "account"; accountId: string }
  | { kind: "room"; accountId: string; roomId: number }
  | { kind: "invite-user"; publicId: string }
  | { kind: "invite-room"; code: string }
  | { kind: "friends"; tab: FriendsTab }

export function isUsername(v: string): boolean {
  return USERNAME_RE.test(v)
}

/** public_id: base62 12-16 ký tự (Base62.publicId) — cũng khớp TOKEN_RE. */
export function isPublicId(v: string): boolean {
  return TOKEN_RE.test(v)
}

/** Mã tài khoản trên URL: chấp nhận public_id mới hoặc username cũ (tương thích ngược). */
function isAccountId(v: string): boolean {
  return isPublicId(v) || isUsername(v)
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/**
 * Bóc route nội bộ từ pathname. Chỉ trả route khi chuỗi hợp lệ; mọi thứ khác
 * (kể cả path lạ) rơi về "root" — không bao giờ trả host/URL ngoài nên không
 * có open-redirect.
 */
export function parseRoute(pathname: string): AppRoute {
  const clean = (pathname ?? "").trim().split(/[?#]/)[0]
  const parts = clean.split("/").filter((p) => p.length > 0)
  if (parts.length === 0) return { kind: "root" }

  const lower = parts[0].toLowerCase()

  if (parts.length === 2 && lower === "u") {
    const id = safeDecode(parts[1])
    if (TOKEN_RE.test(id)) return { kind: "invite-user", publicId: id }
    return { kind: "root" }
  }
  if (parts.length === 2 && lower === "r") {
    const code = safeDecode(parts[1])
    if (TOKEN_RE.test(code)) return { kind: "invite-room", code }
    return { kind: "root" }
  }

  if (lower === "friends") {
    if (parts.length === 1) {
      return { kind: "friends", tab: "requests" }
    }
    const sub = parts[1].toLowerCase()
    if (
      sub === "requests" ||
      sub === "sent" ||
      sub === "suggestions" ||
      sub === "all" ||
      sub === "blocked"
    ) {
      return { kind: "friends", tab: sub }
    }
    return { kind: "friends", tab: "requests" }
  }

  if (parts[0].startsWith("@")) {
    const accountId = safeDecode(parts[0].slice(1))
    if (!isAccountId(accountId)) return { kind: "root" }
    if (parts.length === 1) return { kind: "account", accountId }
    if (parts.length === 3 && parts[1] === "c" && /^\d{1,15}$/.test(parts[2])) {
      const roomId = Number(parts[2])
      if (Number.isSafeInteger(roomId) && roomId > 0) {
        return { kind: "room", accountId, roomId }
      }
    }
    return { kind: "root" }
  }

  return { kind: "root" }
}

export function buildAccountPath(accountId: string): string {
  return `/@${encodeURIComponent(accountId)}`
}

export function buildRoomPath(accountId: string, roomId: number): string {
  return `/@${encodeURIComponent(accountId)}/c/${Math.trunc(roomId)}`
}

export function buildFriendsPath(tab?: FriendsTab): string {
  if (!tab || tab === "requests") return "/friends/requests"
  return `/friends/${tab}`
}

/** Đường dẫn nội bộ để lưu tạm / khôi phục — tuyệt đối không chứa token hay dữ liệu nhạy cảm. */
export function internalPathOf(route: AppRoute): string | null {
  switch (route.kind) {
    case "account":
      return buildAccountPath(route.accountId)
    case "room":
      return buildRoomPath(route.accountId, route.roomId)
    case "invite-user":
      return `/u/${encodeURIComponent(route.publicId)}`
    case "invite-room":
      return `/r/${encodeURIComponent(route.code)}`
    case "friends":
      return buildFriendsPath(route.tab)
    default:
      return null
  }
}

export const PENDING_ROUTE_KEY = "workchat_pending_route"

export function stashPendingPath(path: string) {
  try {
    sessionStorage.setItem(PENDING_ROUTE_KEY, path)
  } catch {
    // bỏ qua nếu storage bị khoá
  }
}

export function takePendingPath(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_ROUTE_KEY)
    if (v) sessionStorage.removeItem(PENDING_ROUTE_KEY)
    return v
  } catch {
    return null
  }
}

export function clearPendingPath() {
  try {
    sessionStorage.removeItem(PENDING_ROUTE_KEY)
  } catch {
    // bỏ qua
  }
}