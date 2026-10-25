import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiPublicUser, ApiRoomMember } from './api'
import type { PresenceFrame } from './peer'

export type PresenceState = Map<number, PresenceInfo>

export interface PresenceInfo {
  online: boolean
  lastSeenAt?: number
  ts: number
}

export interface FriendWithPresence {
  id: number
  username: string
  display_name: string
  avatar: string
  online: boolean
  last_seen_at?: number
}

export interface RoomMemberWithPresence extends ApiRoomMember {
  online: boolean
  last_seen_at?: number
}

const PRESENCE_TTL_MS = 60000
const TICK_MS = 30000

function now(): number {
  return Date.now()
}

function isStale(ts: number): boolean {
  return now() - ts > PRESENCE_TTL_MS * 2
}

export function createPresenceStore() {
  const state = new Map<number, PresenceInfo>()
  const listeners = new Set<() => void>()

  function set(uid: number, info: PresenceInfo) {
    state.set(uid, info)
    notify()
  }

  function applyFrame(f: PresenceFrame) {
    if (!f || typeof f.userId !== 'number' || f.userId <= 0) return
    set(f.userId, { online: !!f.online, lastSeenAt: f.lastSeenAt, ts: now() })
  }

  function seedFromRoomMembers(members: ApiRoomMember[] | undefined | null) {
    if (!Array.isArray(members)) return
    const t = now()
    for (const m of members) {
      const uid = m.id
      if (!uid) continue
      const cur = state.get(uid)
      if (cur && cur.ts >= t - 500) continue
      state.set(uid, {
        online: !!m.online,
        lastSeenAt: m.last_seen_at,
        ts: t,
      })
    }
    notify()
  }

  function seedFromFriends(friends: ApiPublicUser[] | undefined | null) {
    if (!Array.isArray(friends)) return
    const t = now()
    for (const f of friends) {
      const uid = f.id
      if (!uid) continue
      const cur = state.get(uid)
      if (cur && cur.ts >= t - 500) continue
      state.set(uid, {
        online: !!f.online,
        lastSeenAt: f.last_seen_at,
        ts: t,
      })
    }
    notify()
  }

  function mergeWithRoomMembers(members: ApiRoomMember[] | undefined | null): RoomMemberWithPresence[] {
    if (!Array.isArray(members)) return []
    const t = now()
    return members.map((m) => {
      const p = state.get(m.id)
      if (p && !isStale(p.ts)) {
        return {
          ...m,
          online: p.online,
          last_seen_at: p.lastSeenAt ?? m.last_seen_at,
        }
      }
      return {
        ...m,
        online: !!m.online,
        last_seen_at: m.last_seen_at,
      }
    })
  }

  function mergeWithFriends(friends: ApiPublicUser[] | undefined | null): FriendWithPresence[] {
    if (!Array.isArray(friends)) return []
    const t = now()
    return friends.map((f) => {
      const p = state.get(f.id ?? 0)
      if (p && !isStale(p.ts)) {
        return {
          ...f,
          id: f.id ?? 0,
          username: (f as any).username || '',
          online: p.online,
          last_seen_at: p.lastSeenAt ?? f.last_seen_at,
        }
      }
      return {
        ...f,
        id: f.id ?? 0,
        username: (f as any).username || '',
        online: !!f.online,
        last_seen_at: f.last_seen_at,
      }
    })
  }

  function get(uid: number): PresenceInfo | undefined {
    const p = state.get(uid)
    if (!p) return undefined
    if (isStale(p.ts)) return undefined
    return p
  }

  function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function notify() {
    listeners.forEach((l) => l())
  }

  function clear() {
    state.clear()
    notify()
  }

  return {
    set,
    applyFrame,
    seedFromRoomMembers,
    seedFromFriends,
    mergeWithRoomMembers,
    mergeWithFriends,
    get,
    subscribe,
    clear,
  }
}

export type PresenceStore = ReturnType<typeof createPresenceStore>

export function usePresence(store: PresenceStore) {
  const [, setTick] = useState(0)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    unsubRef.current = store.subscribe(() => setTick((x) => x + 1))
    return () => {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }, [store])

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  return useMemo(() => store, [store, setTick])
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatLastSeen(ts?: number): string {
  if (!ts || ts <= 0) return ''
  const diff = Math.max(0, Date.now() - ts)
  if (diff < MINUTE) return 'Vừa hoạt động'
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE)
    return `Hoạt động ${m} phút trước`
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    return `Hoạt động ${h} giờ trước`
  }
  const d = Math.floor(diff / DAY)
  return `Hoạt động ${d} ngày trước`
}
