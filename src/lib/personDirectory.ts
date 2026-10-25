/**
 * THƯ VIỆN NGƯỜI DÙNG (nguồn dữ liệu ẢNH + TÊN "ở ngoài") cho MỌI màn hình.
 *
 * Nguyên tắc: màn hình gọi **không bao giờ** chép ảnh vào state cuộc gọi hay nhận
 * ảnh từ payload báo hiệu. Mọi chỗ hiển thị tra **theo userId** vào đúng nguồn mà
 * danh sách hội thoại / danh sách bạn / tiêu đề phòng đang dùng:
 *   thành viên hội thoại (`/api/rooms`) → danh sách bạn (`/api/friends`) →
 *   hồ sơ mình (`/api/me`) → nếu vẫn thiếu thì gọi API lấy rồi GHI VÀO ĐÂY.
 *
 * Store ở tầng module (ngoài React state) nên dữ liệu đến **chạy lại** (không cần
 * tải lại trang): `<img src` cập nhật ngay khi có ảnh.
 */
import { useEffect, useSyncExternalStore } from "react"
import { resolveAvatarUrl } from "./avatarUrl.ts"
import { initialsOf } from "./callView.ts"

export interface PersonEntry {
  id: number
  /** Họ tên hiển thị (ưu tiên display_name). */
  name?: string
  username?: string
  publicId?: string
  /** Ảnh THÔ (data URI hoặc URL); chuẩn hoá bằng `resolveAvatarUrl` khi hiển thị. */
  avatar?: string
}

export type PersonSnapshot = Readonly<
  Record<number, PersonEntry | undefined>
>

const EMPTY: PersonSnapshot = Object.freeze({})

const people = new Map<number, PersonEntry>()
const listeners = new Set<() => void>()
let snapshot: PersonSnapshot = EMPTY

function publish() {
  const next: Record<number, PersonEntry> = {}
  for (const [id, p] of people) next[id] = p
  snapshot = Object.freeze(next)
  for (const l of listeners) l()
}

export function subscribePersonDirectory(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getPersonDirectory(): PersonSnapshot {
  return snapshot
}

function changed(prev: PersonEntry | undefined, next: PersonEntry): boolean {
  if (!prev) return true
  return (
    (prev.name ?? "") !== (next.name ?? "") ||
    (prev.username ?? "") !== (next.username ?? "") ||
    (prev.publicId ?? "") !== (next.publicId ?? "") ||
    (prev.avatar ?? "") !== (next.avatar ?? "")
  )
}

/** Ghi/ghi đè một người vào thư viện (chỉ phát sự kiện khi thật sự đổi). */
export function putPerson(p: PersonEntry | null | undefined): void {
  if (!p || !p.id) return
  const id = p.id
  const prev = people.get(id)
  const merged: PersonEntry = {
    id,
    name: (p.name ?? "").trim() || prev?.name,
    username: (p.username ?? "").trim() || prev?.username,
    publicId: (p.publicId ?? "").trim() || prev?.publicId,
    // Ảnh rỗng/"" KHÔNG xoá ảnh đã có (server trả "" khi không có ảnh).
    avatar: (p.avatar ?? "").trim() || prev?.avatar,
  }
  if (!changed(prev, merged)) return
  people.set(id, merged)
  publish()
}

/** Trỏ nhiều người (danh sách thành viên / bạn) vào thư viện. */
export function putPeople(list: Array<PersonEntry | null | undefined>): void {
  let dirty = false
  for (const p of list) {
    if (!p || !p.id) continue
    const id = p.id
    const prev = people.get(id)
    const merged: PersonEntry = {
      id,
      name: (p.name ?? "").trim() || prev?.name,
      username: (p.username ?? "").trim() || prev?.username,
      publicId: (p.publicId ?? "").trim() || prev?.publicId,
      avatar: (p.avatar ?? "").trim() || prev?.avatar,
    }
    if (!changed(prev, merged)) continue
    people.set(id, merged)
    dirty = true
  }
  if (dirty) publish()
}

export function getPerson(id?: number): PersonEntry | undefined {
  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return undefined
  return people.get(id)
}

/** Ảnh người theo ID — đã chuẩn hoá về URL tương đối cùng origin ("" nếu chưa có). */
export function avatarOf(id?: number): string {
  return resolveAvatarUrl(getPerson(id)?.avatar)
}

/** Tên người theo ID (fallback rỗng — nơi hiển thị tự chọn chuỗi dự phòng). */
export function nameOf(id?: number): string {
  return (getPerson(id)?.name ?? "").trim()
}

export function hasPerson(id?: number): boolean {
  return getPerson(id) !== undefined
}

/* -------------------------------------------------------------------------- */
/* Lấy bổ sung khi thư viện CHƯA có người gọi (người lạ / chưa tải xong)      */
/* -------------------------------------------------------------------------- */

export type PersonFetcher = (
  id: number,
  opts: { roomId?: number; publicId?: string },
) => Promise<void>

const inflight = new Set<string>()
let fetcher: PersonFetcher | null = null

/** Đổi nguồn lấy dữ liệu (test inject; app để mặc định gọi API phòng/hồ sơ). */
export function setPersonFetcher(f: PersonFetcher | null): void {
  fetcher = f
}

async function defaultFetcher(
  id: number,
  opts: { roomId?: number; publicId?: string },
): Promise<void> {
  const { api } = await import("./api.ts")
  // Ưu tiên chi tiết phòng: trả về CÙNG nguồn với danh sách hội thoại (thành viên
  // + ảnh) nên một lần gọi lấp được mọi người trong phòng (kể cả cuộc gọi nhóm).
  if (opts.roomId) {
    try {
      const res = await api.roomDetail(opts.roomId)
      const room = res.ok && res.data ? res.data.room : undefined
      if (room?.members) {
        putPeople(
          room.members.map((m) => ({
            id: m.id,
            name: m.display_name || m.username,
            username: m.username,
            publicId: m.public_id,
            avatar: m.avatar,
          })),
        )
        if (people.has(id)) return
      }
    } catch {
      /* rơi xuống thử theo public_id */
    }
  }
  const pid = opts.publicId || getPerson(id)?.publicId
  if (pid) {
    try {
      const res = await api.userByPublicId(pid)
      const user = res.ok && res.data ? res.data.user : undefined
      if (user) {
        putPerson({
          id: typeof user.id === "number" && user.id > 0 ? user.id : id,
          name: user.display_name || user.username,
          username: user.username,
          publicId: user.public_id,
          avatar: user.avatar,
        })
      }
    } catch {
      /* bỏ qua — màn hình giữ chữ viết tắt */
    }
  }
}

/**
 * Đảm bảo có dữ liệu người theo ID: nếu đã có trong thư viện thì thôi, nếu chưa
 * thì gọi API một lần (chống gọi trùng) và ghi vào CÙNG thư viện. Trong lúc chờ,
 * màn hình vẫn hiện chữ viết tắt; khi API trả về, ảnh tự thay.
 */
export async function ensurePerson(
  id: number,
  opts: { roomId?: number; publicId?: string } = {},
): Promise<boolean> {
  if (!id || id <= 0) return false
  if (people.has(id)) return true
  const key = `${id}:${opts.roomId ?? ""}:${opts.publicId ?? ""}`
  if (inflight.has(key)) return false
  inflight.add(key)
  try {
    const run = fetcher ?? defaultFetcher
    await run(id, opts)
    return people.has(id)
  } catch {
    return false
  } finally {
    inflight.delete(key)
  }
}

/** Gọi API cho tập ID đang thiếu (dùng cho mọi người trong một cuộc gọi). */
export async function ensurePeople(
  ids: Array<number | undefined | null>,
  opts: { roomId?: number } = {},
): Promise<void> {
  const wanted: number[] = []
  for (const id of ids) {
    if (typeof id === "number" && id > 0 && !people.has(id)) wanted.push(id)
  }
  await Promise.all(wanted.map((id) => ensurePerson(id, opts)))
}

/* -------------------------------------------------------------------------- */
/* Hook cho component                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Ảnh chụp toàn thư viện — component tự render lại khi có dữ liệu mới.
 * Dùng được trong `useMemo` (đọc theo id ở mức render, không cần hook lặp).
 */
export function usePersonDirectory(): PersonSnapshot {
  return useSyncExternalStore(
    subscribePersonDirectory,
    getPersonDirectory,
    getPersonDirectory,
  )
}

/** Đọc người theo ID — **tự render lại** khi thư viện có dữ liệu mới. */
export function usePerson(id?: number): PersonEntry | undefined {
  const snap = usePersonDirectory()
  return typeof id === "number" && id > 0 ? snap[id] : undefined
}

/** Ảnh người theo ID (chuẩn hoá URL) — trả "" khi chưa có → UI hiện chữ đầu. */
export function useAvatarOf(id?: number): string {
  return resolveAvatarUrl(usePerson(id)?.avatar)
}

/** Tên người theo ID ("" khi thiếu). */
export function useNameOf(id?: number, fallback = ""): string {
  const n = (usePerson(id)?.name ?? "").trim()
  return n || fallback
}

/**
 * Tra ảnh theo ID **ngay lúc hiển thị**; đồng thời tự gọi API nếu thư viện chưa
 * có người này. Kết quả: hiện chữ viết tắt → có dữ liệu → chuyển sang ảnh,
 * KHÔNG cần tải lại trang.
 */
export function usePersonAvatar(opts: {
  id?: number
  roomId?: number
  publicId?: string
  /** Tự gọi API khi thiếu (mặc định true). */
  autoFetch?: boolean
}): { id?: number; name: string; avatar: string; ready: boolean } {
  const { id, roomId, publicId, autoFetch = true } = opts
  const person = usePerson(id)
  useEffect(() => {
    if (!autoFetch || typeof id !== "number" || id <= 0) return
    if (people.has(id)) return
    void ensurePerson(id, { roomId, publicId })
  }, [id, roomId, publicId, autoFetch])
  return {
    id,
    name: (person?.name ?? "").trim(),
    avatar: resolveAvatarUrl(person?.avatar),
    ready: person !== undefined,
  }
}

export interface UserProfile {
  id?: number
  displayName: string
  avatarUrl: string
  username?: string
  initials: string
  ready: boolean
}

/**
 * Tra cứu hồ sơ người dùng (họ tên hiển thị + ảnh) từ MỘT nguồn DUY NHẤT.
 * Ưu tiên display_name -> username -> fallback.
 */
export function getUserProfile(id?: number, fallbackName = ""): UserProfile {
  const p = getPerson(id)
  const displayName =
    (p?.name ?? "").trim() ||
    (p?.username ?? "").trim() ||
    fallbackName.trim() ||
    ""
  const avatarUrl = resolveAvatarUrl(p?.avatar)
  const initials = initialsOf(displayName)
  return {
    id,
    displayName,
    avatarUrl,
    username: p?.username,
    initials,
    ready: p !== undefined,
  }
}

/**
 * Hook DUY NHẤT tra họ tên hiển thị + ảnh theo userId cho TOÀN BỘ màn hình gọi
 * (đổ chuông, hai ô đã kết nối, tiêu đề, thanh thu nhỏ).
 * Tự động gọi API bổ sung nếu chưa có trong store, tự cập nhật lại component
 * khi có dữ liệu (không cần tải lại trang).
 */
export function useUserProfile(
  id?: number,
  opts: {
    roomId?: number
    publicId?: string
    fallbackName?: string
    autoFetch?: boolean
  } = {},
): UserProfile {
  const { roomId, publicId, fallbackName = "", autoFetch = true } = opts
  const person = usePerson(id)
  useEffect(() => {
    if (!autoFetch || typeof id !== "number" || id <= 0) return
    if (people.has(id)) return
    void ensurePerson(id, { roomId, publicId })
  }, [id, roomId, publicId, autoFetch])

  const displayName =
    (person?.name ?? "").trim() ||
    (person?.username ?? "").trim() ||
    fallbackName.trim() ||
    ""
  const avatarUrl = resolveAvatarUrl(person?.avatar)
  const initials = initialsOf(displayName)

  return {
    id,
    displayName,
    avatarUrl,
    username: person?.username,
    initials,
    ready: person !== undefined,
  }
}

