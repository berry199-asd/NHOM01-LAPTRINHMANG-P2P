import { useState, useRef, useEffect } from "react"
import type {
  Message,
  Conversation,
  ChatFile,
  MessageCallData,
  PeerUploadResult,
} from "../../types/chat"
import { formatBytes } from "../../types/chat"
import { themeIcon, EMOJI_CHOICE } from "./emojiData"
import { initialsOf, colorForName } from "./bubbles/VoiceBubble"
import { readVideoMeta } from "./bubbles/QuoteBlock"
import { formatClock, nowTime as now, genClientId, callLabel } from "../rooms/useRoomManagement"
import { resolvePresence } from "../../lib/presenceLabel"
import {
  api,
  type ApiMessage,
  type ApiPublicUser,
  type ApiRoom,
} from "../../lib/api"
import {
  type PeerChatMessage,
  type PeerOfflineMsg,
  type PeerHistoryMsg,
  type PeerUiFrame,
  PeerClient,
} from "../../lib/peer"

import { compressImage, isSvg } from "../../lib/imageProcessor"
import { getUserProfile } from "../../lib/personDirectory"
import { sanitizeFileName, validateFileExtension, inspectMagicBytes } from "../../lib/fileValidator"
import { validateFileSize } from "../../lib/fileLimits"
import { validateImageSize, validateFileCount, getFileLimits } from "../../lib/fileLimits"


import {
  applyStatusPatch,
  mergePendingStatus,
  pendingKey,
  rememberPending,
  sendStateToStatus,
  type StatusPatch,
} from "../../lib/pendingStatus"

const EDIT_WINDOW_MS = 15 * 60 * 1000
/** Không nhận được send_state trong 8 giây thì coi như đang chờ và chủ động gửi lại. */
const SEND_STATE_TIMEOUT_MS = 8000
const HISTORY_PAGE_SIZE = 50
const RECENT_EMOJI_KEY = "chat_recent_emojis"

const PEER_DEBUG =
  typeof localStorage !== "undefined" &&
  localStorage.getItem("peerDebug") === "1"

function dbg(...args: unknown[]) {
  if (PEER_DEBUG) console.debug("[chat]", ...args)
}

function shortCid(cid: string | undefined): string {
  return cid ? cid.slice(-6) : "-"
}

function makeInitials(name: string, email?: string): string {
  const trimmed = name.trim()
  if (trimmed) {
    const parts = trimmed.split(/\s+/)
    const first = parts[0]?.[0] ?? ""
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
    return (first + last).toUpperCase()
  }
  const local = (email ?? "").split("@")[0] ?? ""
  return local.slice(0, 2).toUpperCase() || "??"
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

interface UseChatMessagesOptions {
  meId: number
  meIdRef: React.MutableRefObject<number>
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  selectedId: number
  selected: Conversation
  selectedRoomIdRef: React.MutableRefObject<number | undefined>
  conversationsRef: React.MutableRefObject<Conversation[]>
  peerRef: React.MutableRefObject<PeerClient | null>
  peerOnRef: React.MutableRefObject<boolean>
  peerState: string
  peerApiPortRef: React.MutableRefObject<number>
  e2eState: string
  pushToast: (text: string) => void
  refreshRooms: () => Promise<void>
  refreshFriendList: () => Promise<void>
  messageInputRef: React.RefObject<HTMLInputElement | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  atBottomRef: React.MutableRefObject<boolean>
  setShowJump: (show: boolean) => void
  clearRecordedVoice: () => void
  seenPeerIds: React.MutableRefObject<Set<string>>
  pendingOfflineRef: React.MutableRefObject<PeerOfflineMsg[]>
  pendingStatusRef: React.MutableRefObject<Map<string, StatusPatch>>
  lastReadRef: React.MutableRefObject<Map<number, string>>
  lastTypingSentRef: React.MutableRefObject<number>
  recUrl: string | null
  recDuration: number
}

/**
 * Dựng thẻ tệp từ metadata `media_ref` (JSON đã giải mã E2E) — dùng cho lịch sử cục bộ
 * của cả bản gửi và bản nhận, để tệp không hiện thành chuỗi JSON sau khi tải lại trang.
 */
export const mediaRefToFile = (text: string | null | undefined): ChatFile | undefined => {
  if (!text) return undefined
  try {
    const p = JSON.parse(text) as {
      fileId?: unknown
      name?: unknown
      mime?: unknown
      size?: unknown
      sha256?: unknown
    }
    if (!p || typeof p.fileId !== "string" || !p.fileId) return undefined
    const mime = typeof p.mime === "string" && p.mime ? p.mime : "application/octet-stream"
    return {
      name: typeof p.name === "string" && p.name ? p.name : "file",
      size: formatBytes(typeof p.size === "number" ? p.size : 0),
      progress: 100,
      done: true,
      isImage: mime.startsWith("image/") || undefined,
      isVideo: mime.startsWith("video/") || undefined,
      fileId: p.fileId,
      mime,
      checksum:
        typeof p.sha256 === "string" && p.sha256
          ? p.sha256.slice(0, 8).toUpperCase()
          : undefined,
      state: "sent",
    }
  } catch {
    return undefined
  }
}

export function parseChatPayload(
  rawText: string | null | undefined,
  fallbackEmoji?: string,
): {
  text: string
  kind: "chat" | "call"
  callData?: MessageCallData
  isLike: boolean
} {
  if (!rawText) return { text: "", kind: "chat", isLike: false }
  if (rawText.startsWith('{"kind":"call"')) {
    try {
      const p = JSON.parse(rawText)
      if (p.kind === "call" && p.call) {
        return { text: rawText, kind: "call", callData: p.call, isLike: false }
      }
    } catch {}
  }
  if (rawText.startsWith('{"kind":"like"')) {
    try {
      const p = JSON.parse(rawText)
      if (p.kind === "like" && p.emoji) {
        return { text: p.emoji, kind: "chat", isLike: true }
      }
    } catch {}
  }
  const trimmed = rawText.trim()
  if (trimmed && (trimmed === fallbackEmoji || EMOJI_CHOICE.includes(trimmed))) {
    return { text: trimmed, kind: "chat", isLike: true }
  }
  return { text: rawText, kind: "chat", isLike: false }
}

export function useChatMessages({
  meId,
  meIdRef,
  conversations,
  setConversations,
  selectedId,
  selected,
  selectedRoomIdRef,
  conversationsRef,
  peerRef,
  peerOnRef,
  peerState,
  peerApiPortRef,
  e2eState,
  pushToast,
  refreshRooms,
  refreshFriendList,
  messageInputRef,
  scrollRef,
  atBottomRef,
  setShowJump,
  clearRecordedVoice,
  seenPeerIds,
  pendingOfflineRef,
  pendingStatusRef,
  lastReadRef,
  lastTypingSentRef,
  recUrl,
  recDuration,
}: UseChatMessagesOptions) {
  const [messageInput, setMessageInput] = useState("")
  const [replyToId, setReplyToId] = useState<number | null>(null)
  const [jumpId, setJumpId] = useState<number | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiQuery, setEmojiQuery] = useState("")
  const [emojiTab, setEmojiTab] = useState<"recent" | "all">("all")
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) ?? "[]")
    } catch {
      return []
    }
  })
  const [seenModalMsg, setSeenModalMsg] = useState<Message | null>(null)
  const [typing, setTyping] = useState<{ convId: number; name: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState<Record<number, boolean>>({})
  const [mediaPreview, setMediaPreview] = useState<{
    name: string
    size: number
    url: string
    kind: "image" | "video"
    duration?: number
  }[] | null>(null)
  const [previewPlayUrl, setPreviewPlayUrl] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState("")
  const [shareMsg, setShareMsg] = useState<Message | null>(null)
  const [shareTargets, setShareTargets] = useState<number[]>([])
  const [shareQuery, setShareQuery] = useState("")
  const [shareCaption, setShareCaption] = useState("")
  const [activeActionsId, setActiveActionsId] = useState<number | null>(null)
  const [reactionMsgId, setReactionMsgId] = useState<number | null>(null)
  const [reactionTab, setReactionTab] = useState<string | null>(null)

  const historyLoadingRef = useRef(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const prependHeightRef = useRef<number | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragCounterRef = useRef(0)
  const outgoingAcksRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    return () => {
      outgoingAcksRef.current.forEach((t) => clearTimeout(t))
      outgoingAcksRef.current.clear()
    }
  }, [])

  const pushRecentEmoji = (emoji: string) => {
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((x) => x !== emoji)].slice(0, 24)
      try {
        localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const insertEmojiAtCursor = (emoji: string) => {
    pushRecentEmoji(emoji)
    const el = messageInputRef.current
    const start = el ? (el.selectionStart ?? messageInput.length) : messageInput.length
    const end = el ? (el.selectionEnd ?? messageInput.length) : messageInput.length
    const next = messageInput.slice(0, start) + emoji + messageInput.slice(end)
    setMessageInput(next)
    const caret = start + emoji.length
    window.setTimeout(() => {
      const inp = messageInputRef.current
      if (inp) {
        inp.focus()
        inp.setSelectionRange(caret, caret)
      }
    }, 0)
  }

  const peerReady =
    selected.realId === undefined ||
    (peerState === "on" && e2eState === "unlocked")

  const canSend = () => {
    if (!peerReady) {
      pushToast("Peer Core chưa sẵn sàng — không thể gửi tin mã hoá")
      return false
    }
    if (!selected.isGroup && selected.blocked) {
      pushToast("Không thể gửi — bạn đã chặn người dùng này")
      return false
    }
    if (!selected.isGroup && !selected.online && selected.realId === undefined) {
      pushToast(`Không thể gửi — ${selected.name} đang ngoại tuyến`)
      return false
    }
    return true
  }

  const updateMessage = (id: number, patch: Partial<Message>) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === id ? { ...m, ...patch } : m,
              ),
            }
          : c,
      ),
    )
  }

  const patchRoomMsg = (
    roomId: number,
    clientId: string,
    fn: (m: Message) => Message,
  ) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.realId !== roomId) return c
        let lastMsgRecalled = false
        const total = c.messages.length
        const updated = c.messages.map((m, idx) => {
          const match =
            m.clientId === clientId ||
            (m.file?.fileId &&
              (clientId === `file:${m.file.fileId}` ||
                clientId === m.file.fileId))
          if (!match) return m
          const patched = fn(m)
          if (idx === total - 1 && patched.recalled) {
            lastMsgRecalled = true
          }
          return patched
        })
        return {
          ...c,
          messages: updated,
          lastMessage: lastMsgRecalled ? "Tin nhắn đã được thu hồi" : c.lastMessage,
        }
      }),
    )
  }

  const prunePendingStatus = () => {
    const buf = pendingStatusRef.current
    if (buf.size === 0) return
    for (const c of conversationsRef.current) {
      if (c.realId === undefined) continue
      for (const m of c.messages) {
        if (m.clientId) buf.delete(pendingKey(c.realId, m.clientId))
      }
    }
  }

  const applySendState = (
    roomId: number,
    clientId: string | undefined,
    patch: StatusPatch,
  ) => {
    if (!clientId) return
    prunePendingStatus()
    const present = (conversationsRef.current.find((c) => c.realId === roomId)
      ?.messages ?? []).some((m) => m.clientId === clientId)
    if (!present) {
      rememberPending(pendingStatusRef.current, roomId, clientId, patch)
    }
    setConversations((prev) => {
      let matched = false
      const next = prev.map((c) => {
        if (c.realId !== roomId) return c
        let hit = false
        const messages = c.messages.map((m) => {
          if (m.clientId !== clientId) return m
          hit = true
          return applyStatusPatch(m, patch)
        })
        if (!hit) return c
        matched = true
        return { ...c, messages }
      })
      return matched ? next : prev
    })
    dbg("send_state", roomId, shortCid(clientId), patch.status, present ? "áp" : "lưu tạm")
  }

  const handlePeerEdit = (roomId: number, clientId: string, text: string) => {
    patchRoomMsg(roomId, clientId, (m) => ({ ...m, text, edited: true }))
  }

  const handlePeerRecall = (roomId: number, clientId: string) => {
    patchRoomMsg(roomId, clientId, (m) => ({
      ...m,
      recalled: true,
      text: "",
      edited: true,
      file: undefined,
      voice: undefined,
      reactions: undefined,
    }))
  }

  const handlePeerReaction = (
    roomId: number,
    clientId: string,
    emoji: string,
    remove: boolean,
    fromName: string,
    fromUserId?: number,
  ) => {
    patchRoomMsg(roomId, clientId, (m) => {
      if (!emoji && !remove) return m
      const reactions = m.reactions ?? []
      const matchMe = (r: any) =>
        !r.mine && ((fromUserId && r.userId === fromUserId) || (fromName && r.name === fromName))
      if (remove) {
        return {
          ...m,
          reactions: reactions.filter((r) => !matchMe(r)),
        }
      }
      const withoutPrev = reactions.filter((r) => !matchMe(r))
      return {
        ...m,
        reactions: [
          ...withoutPrev,
          {
            userId: fromUserId,
            emoji,
            name: fromName,
            initials: makeInitials(fromName, fromName).slice(0, 2).toUpperCase(),
            mine: false,
          },
        ],
      }
    })
  }

  const handlePeerPresence = (userId: number, online: boolean) => {
    const myId = meIdRef.current
    setConversations((prev) =>
      prev.map((c) => {
        const target = c.members?.find((m) => m.id === userId)
        if (!target || target.online === online) return c
        const members = (c.members ?? []).map((m) =>
          m.id === userId ? { ...m, online } : m,
        )
        const otherOnline = resolvePresence(members, myId, !!c.isGroup)
        return { ...c, members, online: otherOnline }
      }),
    )
  }

  const markRoomRead = (roomId: number, clientMsgId?: string) => {
    if (peerOnRef.current === false && clientMsgId === undefined) return
    if (!roomId) return
    setConversations((prev) =>
      prev.map((c) =>
        c.realId === roomId && (c.unread ?? 0) !== 0 ? { ...c, unread: 0 } : c,
      ),
    )
    if (clientMsgId && lastReadRef.current.get(roomId) === clientMsgId) return
    const cid =
      clientMsgId && /^[0-9A-Za-z_-]{8,64}$/.test(clientMsgId)
        ? clientMsgId
        : lastReadRef.current.get(roomId) ?? ""
    if (!cid) return
    lastReadRef.current.set(roomId, cid)
    if (peerOnRef.current) {
      dbg("gửi seen", roomId, shortCid(cid))
      peerRef.current?.send({ type: "seen", roomId, messageId: cid })
    }
    api.markRoomRead(roomId, cid).catch(() => {})
  }

  const handlePeerSeen = (
    roomId: number | undefined,
    messageId: string | undefined,
    fromUserId?: number,
  ) => {
    if (roomId === undefined || fromUserId === meId) return
    const present = messageId
      ? (conversationsRef.current.find((c) => c.realId === roomId)?.messages ?? []).some(
          (m) => m.clientId === messageId,
        )
      : true
    if (messageId && !present) {
      rememberPending(pendingStatusRef.current, roomId, messageId, { status: "seen" })
    }
    setConversations((prev) =>
      prev.map((c) => {
        if (c.realId !== roomId) return c
        let cutoff = Infinity
        if (messageId) {
          const target = c.messages.find((m) => m.clientId === messageId)
          if (target && target.sentAt !== undefined) cutoff = target.sentAt
        }
        const changed = c.messages.some(
          (m) => m.fromMe && m.status !== "seen" && (m.sentAt ?? 0) <= cutoff,
        )
        if (!changed) return c
        const messages = c.messages.map((m) =>
          m.fromMe && m.status !== "seen" && (m.sentAt ?? 0) <= cutoff
            ? { ...m, status: "seen" as const }
            : m,
        )
        return { ...c, messages }
      }),
    )
  }

  const handlePeerTyping = (roomId: number, name: string, fromUserId?: number) => {
    const conv = conversationsRef.current.find((x) => x.realId === roomId)
    if (!conv) return
    let displayName = ""
    if (fromUserId && fromUserId > 0) {
      const prof = getUserProfile(fromUserId)
      if (prof.ready && prof.displayName) displayName = prof.displayName
      if (!displayName && conv.members) {
        const m = conv.members.find((x) => x.id === fromUserId)
        if (m?.name) displayName = m.name
      }
    }
    if (!displayName && name && conv.members) {
      const m = conv.members.find(
        (x) => (x as any).username === name || x.name === name,
      )
      if (m?.name) displayName = m.name
    }
    if (!displayName && !conv.isGroup) {
      displayName = conv.name
    }
    if (!displayName) {
      displayName = name || "Ai đó"
    }
    setTyping({ convId: conv.id, name: displayName })
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    typingTimerRef.current = setTimeout(() => setTyping(null), 4000)
  }

  const pullLocalHistory = (roomId: number, before?: number, limit = HISTORY_PAGE_SIZE) => {
    if (!peerOnRef.current || !peerRef.current) return
    historyLoadingRef.current = true
    setHistoryLoading(true)
    peerRef.current.send({
      type: "history",
      roomId,
      limit,
      before,
    })
  }

  const handleDecryptBatch = (
    items: Array<{ clientMsgId: string; roomId: number; text: string; status?: string; contentType?: string }>
  ) => {
    if (!items || items.length === 0) return
    const byCid = new Map(items.map((it) => [it.clientMsgId, it]))
    setConversations((prev) =>
      prev.map((c) => {
        let changed = false
        const nextMessages = c.messages.map((m) => {
          if (!m.clientId) return m
          const hit = byCid.get(m.clientId)
          if (!hit || m.decrypted) return m
          if (hit.status === "recalled" || m.recalled) {
            changed = true
            return {
              ...m,
              recalled: true,
              text: "",
              file: undefined,
              reactions: undefined,
              decrypted: true,
              undecryptable: false,
              status: "recalled",
            }
          }
          changed = true
          const roomEmoji = c.favEmoji || (c.theme && themeIcon(c)) || "👍"
          const parsed = parseChatPayload(hit.text, roomEmoji)
          const fileData = mediaRefToFile(hit.text)
          const isVoice =
            fileData != null &&
            (fileData.mime?.startsWith("audio/") ||
              fileData.name?.startsWith("voice_") ||
              hit.contentType === "voice")
          const voiceDur = fileData?.name?.match(/_d(\d+)\./)
          const duration = voiceDur ? parseInt(voiceDur[1], 10) : 0
          return {
            ...m,
            text: isVoice ? "Đã gửi một tin nhắn thoại" : (fileData ? fileData.name : parsed.text),
            voice: isVoice
              ? { url: m.voice?.url || "", duration: m.voice?.duration || duration }
              : m.voice,
            file: isVoice ? undefined : (fileData ?? m.file),
            decrypted: true,
            undecryptable: false,
            kind: parsed.kind,
            call: parsed.callData,
            like: parsed.isLike ? true : m.like,
            status: (hit.status as any) ?? m.status,
          }
        })
        if (!changed) return c
        const last = nextMessages[nextMessages.length - 1]
        return {
          ...c,
          messages: nextMessages,
          lastMessage: last?.text ?? c.lastMessage,
        }
      })
    )
  }

  const reDecryptPendingMessages = (roomId?: number) => {
    if (!peerOnRef.current || !peerRef.current) return
    const targetRoomId = roomId ?? selectedRoomIdRef.current
    if (targetRoomId !== undefined) {
      const conv = conversationsRef.current.find((c) => c.realId === targetRoomId)
      if (conv) {
        const pendingCids = conv.messages
          .filter((m) => (!m.decrypted || m.text === null || m.undecryptable) && m.clientId)
          .map((m) => m.clientId as string)
        if (pendingCids.length > 0) {
          peerRef.current.send({
            type: "decrypt_batch",
            clientMsgIds: pendingCids,
            roomId: targetRoomId,
          })
        }
        pullLocalHistory(targetRoomId, undefined, 30)
      }
    }

    const otherRooms = conversationsRef.current
      .filter((c) => c.realId !== undefined && c.realId !== targetRoomId)
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))

    otherRooms.forEach((c, idx) => {
      window.setTimeout(() => {
        if (peerOnRef.current && peerRef.current && c.realId !== undefined) {
          pullLocalHistory(c.realId, undefined, 30)
        }
      }, (idx + 1) * 250)
    })
  }

  const insertOfflineMsg = (msg: PeerOfflineMsg) => {
    const roomId = msg.roomId
    const mine = meId > 0 && msg.senderId === meId
    const conv = conversationsRef.current.find((c) => c.realId === roomId)
    const roomEmoji = conv?.favEmoji || (conv?.theme && themeIcon(conv)) || "👍"
    const parsed = parseChatPayload(msg.text, roomEmoji)
    const fileData = mediaRefToFile(msg.text)
    const nm: Message = {
      id: Date.now() + Math.random(),
      clientId: msg.clientMsgId,
      text: fileData ? fileData.name : parsed.text,
      file: fileData,
      kind: parsed.kind,
      call: parsed.callData,
      like: parsed.isLike || undefined,
      fromMe: mine,
      time: formatClock(msg.sentAt ?? Date.now()),
      status: mine ? "sent" : "delivered",
      sentAt: msg.sentAt ?? Date.now(),
      senderId: msg.senderId,
      senderName: msg.senderUsername,
      senderInitials: msg.senderUsername
        ? makeInitials(msg.senderUsername, msg.senderUsername)
        : undefined,
    }
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.realId === roomId)
      if (idx < 0) return prev
      const c = prev[idx]
      if (msg.clientMsgId && c.messages.some((m) => m.clientId === msg.clientMsgId)) {
        return prev
      }
      const lastMsgText = parsed.callData
        ? callLabel(parsed.callData.type, parsed.callData.dir, parsed.callData.duration, parsed.callData.outcome)
        : nm.text
      const messages = [...c.messages, nm].sort(
        (a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0),
      )
      const updated: typeof c = {
        ...c,
        messages,
        lastMessage: lastMsgText,
        time: nm.time,
        lastAt: Math.max(c.lastAt ?? 0, nm.sentAt ?? 0),
        unread: selectedRoomIdRef.current === c.realId ? 0 : (c.unread ?? 0) + 1,
      }
      const list = [...prev]
      list.splice(idx, 1)
      list.unshift(updated)
      return list
    })
    if (!mine && selectedRoomIdRef.current === roomId) {
      markRoomRead(roomId, msg.clientMsgId)
    }
  }

  const handlePeerOffline = (msg: PeerOfflineMsg) => {
    if (msg.clientMsgId && seenPeerIds.current.has(msg.clientMsgId)) return
    if (msg.clientMsgId) seenPeerIds.current.add(msg.clientMsgId)
    if (!conversationsRef.current.some((c) => c.realId === msg.roomId)) {
      pendingOfflineRef.current.push(msg)
      void refreshRooms().then(() => {
        const pend = pendingOfflineRef.current
        if (pend.length === 0) return
        pendingOfflineRef.current = []
        pend.forEach(insertOfflineMsg)
      })
      return
    }
    insertOfflineMsg(msg)
  }

// mediaRefToFile moved to module level

  const handlePeerHistory = (
    roomId: number,
    msgs: PeerHistoryMsg[],
    hasMore: boolean,
  ) => {
    historyLoadingRef.current = false
    setHistoryLoading(false)
    setHistoryHasMore((prev) => ({ ...prev, [roomId]: hasMore }))
    const byCid = new Map<string, PeerHistoryMsg>()
    msgs.forEach((m) => {
      if (m.clientMsgId) byCid.set(m.clientMsgId, m)
    })
    setConversations((prev) =>
      prev.map((c) => {
        if (c.realId !== roomId) return c
        const have = new Set<string>()
        const knownFileIds = new Set<string>()
        c.messages.forEach((m) => {
          if (m.file?.fileId) knownFileIds.add(m.file.fileId)
        })
        let changed = false
        const filled = c.messages.map((m) => {
          if (!m.clientId) return m
          have.add(m.clientId)
          const h = byCid.get(m.clientId)
          if (!h) return m
          if (h.status === "recalled" || m.recalled) {
            changed = true
            return {
              ...m,
              recalled: true,
              text: "",
              file: undefined,
              reactions: undefined,
              decrypted: true,
              undecryptable: false,
              status: "recalled",
            }
          }
          const fileData = mediaRefToFile(h.text)
          if (fileData) {
            changed = true
            const isVoice =
              fileData.mime?.startsWith("audio/") ||
              fileData.name?.startsWith("voice_") ||
              h.contentType === "voice"
            const voiceDur = fileData.name?.match(/_d(\d+)\./)
            const duration = voiceDur ? parseInt(voiceDur[1], 10) : 0
            return {
              ...m,
              text: isVoice ? "Đã gửi một tin nhắn thoại" : fileData.name,
              voice: isVoice
                ? { url: m.voice?.url || "", duration: m.voice?.duration || duration }
                : undefined,
              file: isVoice ? undefined : fileData,
              decrypted: true,
              undecryptable: false,
            }
          }
          if (m.text && !m.undecryptable && m.decrypted) return m
          if (h.text == null && m.text) return m
          changed = true
          const roomEmoji = c.favEmoji || (c.theme && themeIcon(c)) || "👍"
          const parsed = parseChatPayload(h.text, roomEmoji)
          return {
            ...m,
            text: h.text != null ? parsed.text : (m.text ?? ""),
            decrypted: h.text != null,
            undecryptable: h.text == null,
            kind: parsed.kind,
            call: parsed.callData,
            like: parsed.isLike ? true : m.like,
          }
        })
        const extra: Message[] = msgs
          .filter((h) => h.clientMsgId && !have.has(h.clientMsgId))
          .filter((h) => {
            const f = mediaRefToFile(h.text)
            if (!f) return true
            if (!f.fileId || knownFileIds.has(f.fileId)) return false
            knownFileIds.add(f.fileId)
            return true
          })
          .map((h) => {
            changed = true
            if (h.status === "recalled") {
              return {
                id: Date.now() + Math.random(),
                clientId: h.clientMsgId,
                fromMe: h.direction === "out",
                text: "",
                recalled: true,
                time: formatClock(h.sentAt ?? Date.now()),
                status: "sent" as const,
                sentAt: h.sentAt ?? Date.now(),
                decrypted: true,
              }
            }
            const sender = c.members?.find((m) => m.id === h.senderId)
            const senderName = sender?.name
            const senderInitials = sender?.initials
            const f = mediaRefToFile(h.text)
            if (h.contentType === "media_ref" || h.contentType === "file" || f) {
              const fileObj = f ?? {
                name: "file",
                size: formatBytes(0),
                progress: 100,
                done: true,
                state: "sent" as const,
              }
              const isVoice =
                fileObj.mime?.startsWith("audio/") ||
                fileObj.name?.startsWith("voice_") ||
                h.contentType === "voice"
              const voiceDur = fileObj.name?.match(/_d(\d+)\./)
              const duration = voiceDur ? parseInt(voiceDur[1], 10) : 0
              return {
                id: Date.now() + Math.random(),
                clientId: h.clientMsgId,
                text: isVoice ? "Đã gửi một tin nhắn thoại" : fileObj.name,
                fromMe: h.direction === "out",
                kind: "chat" as const,
                time: formatClock(h.sentAt ?? Date.now()),
                status: h.direction === "out" ? "sent" : "delivered",
                sentAt: h.sentAt ?? Date.now(),
                senderId: h.senderId,
                senderName,
                senderInitials,
                decrypted: true,
                voice: isVoice ? { url: "", duration } : undefined,
                file: isVoice ? undefined : fileObj,
              }
            }
            const roomEmoji = c.favEmoji || (c.theme && themeIcon(c)) || "👍"
            const parsed = parseChatPayload(h.text, roomEmoji)
            return {
              id: Date.now() + Math.random(),
              clientId: h.clientMsgId,
              text: parsed.text,
              fromMe: h.direction === "out",
              kind: parsed.kind,
              call: parsed.callData,
              like: parsed.isLike || undefined,
              time: formatClock(h.sentAt ?? Date.now()),
              status: h.direction === "out" ? "sent" : "delivered",
              sentAt: h.sentAt ?? Date.now(),
              senderId: h.senderId,
              senderName,
              senderInitials,
              decrypted: true,
              undecryptable: h.text == null ? true : undefined,
            }
          })
        if (!changed) return c
        const messages = [...filled, ...extra].sort(
          (a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0),
        )
        const lastMsg = messages[messages.length - 1]
        const lastMsgText =
          lastMsg?.kind === "call" && lastMsg.call
            ? callLabel(
                lastMsg.call.type,
                lastMsg.call.dir,
                lastMsg.call.duration,
                lastMsg.call.outcome,
              )
            : lastMsg?.text ?? c.lastMessage
        const lastAt = messages.reduce(
          (mx, m) => Math.max(mx, m.sentAt ?? 0),
          c.lastAt ?? 0,
        )
        return { ...c, messages, lastMessage: lastMsgText, lastAt }
      }),
    )
    if (prependHeightRef.current !== null) {
      const prevHeight = prependHeightRef.current
      prependHeightRef.current = null
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight - prevHeight
      })
    }
    msgs.forEach((h) => {
      if (!h.text || !h.clientMsgId) return
      const f = mediaRefToFile(h.text)
      if (!f?.fileId) return
      const isVoice =
        f.mime?.startsWith("audio/") ||
        f.name?.startsWith("voice_") ||
        h.contentType === "voice"
      if (!f.isImage && !f.isVideo && !isVoice) return
      void openPeerFile(f.fileId).then((r) => {
        if (r.url) {
          if (isVoice) {
            const voiceDur = f.name?.match(/_d(\d+)\./)
            const duration = voiceDur ? parseInt(voiceDur[1], 10) : 0
            setConversations((prev) =>
              prev.map((c) =>
                c.realId === roomId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.clientId === h.clientMsgId
                          ? { ...m, voice: { url: r.url!, duration: m.voice?.duration || duration } }
                          : m,
                      ),
                    }
                  : c,
              ),
            )
          } else {
            setFileUrlByClient(roomId, h.clientMsgId, r.url)
          }
        }
      })
    })
  }

  const handlePeerChat = (chat: PeerChatMessage) => {
    if (chat.clientId && seenPeerIds.current.has(chat.clientId)) return
    if (chat.clientId) seenPeerIds.current.add(chat.clientId)
    const roomId = chat.roomId
    if (!roomId) return
    const mine = meId > 0 && chat.fromUserId === meId
    if (!mine && !conversationsRef.current.some((c) => c.realId === roomId)) {
      pendingOfflineRef.current.push({
        clientMsgId: chat.clientId ?? "",
        roomId,
        senderId: chat.fromUserId ?? 0,
        contentType: "text",
        text: chat.text ?? "",
        sentAt: chat.ts ?? Date.now(),
      })
      void refreshRooms().then(() => {
        const pend = pendingOfflineRef.current
        if (pend.length === 0) return
        pendingOfflineRef.current = []
        pend.forEach(insertOfflineMsg)
      })
      return
    }
    const conv = conversationsRef.current.find((c) => c.realId === roomId)
    const roomEmoji = conv?.favEmoji || (conv?.theme && themeIcon(conv)) || "👍"
    const parsed = parseChatPayload(chat.text, roomEmoji)
    const nm: Message = mergePendingStatus(pendingStatusRef.current, roomId, {
      id: Date.now(),
      clientId: chat.clientId,
      text: parsed.text,
      kind: parsed.kind,
      call: parsed.callData,
      like: parsed.isLike || undefined,
      fromMe: mine,
      time: formatClock(chat.ts ?? Date.now()),
      status: mine ? "sent" : "delivered",
      sentAt: chat.ts ?? Date.now(),
      senderId: chat.fromUserId,
      senderName: chat.fromUsername,
      senderInitials: chat.fromUsername
        ? makeInitials(chat.fromUsername, chat.fromUsername)
        : undefined,
      replyToClientId: chat.replyToClientId,
      decrypted: true,
    })
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.realId === roomId)
      if (idx < 0) return prev
      const c = prev[idx]
      if (chat.clientId && c.messages.some((m) => m.clientId === chat.clientId)) {
        return prev
      }
      if (chat.replyToClientId) {
        const found = c.messages.find(
          (m) =>
            m.clientId === chat.replyToClientId ||
            (m.file?.fileId &&
              (chat.replyToClientId === `file:${m.file.fileId}` ||
                chat.replyToClientId === m.file.fileId)),
        )
        if (found) nm.replyId = found.id
      }
      const lastMsgText = parsed.callData
        ? callLabel(parsed.callData.type, parsed.callData.dir, parsed.callData.duration, parsed.callData.outcome)
        : nm.text
      const updated: typeof c = {
        ...c,
        messages: [...c.messages, nm],
        lastMessage: lastMsgText,
        time: nm.time,
        lastAt: Date.now(),
        unread: selectedRoomIdRef.current === c.realId ? 0 : (c.unread ?? 0) + 1,
      }
      const list = [...prev]
      list.splice(idx, 1)
      list.unshift(updated)
      return list
    })
    if (!mine && selectedRoomIdRef.current === roomId) {
      markRoomRead(roomId, chat.clientId ?? "")
    }
  }

  const patchMessageFile = (id: number, patch: Partial<ChatFile>) => {
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === id && m.file ? { ...m, file: { ...m.file, ...patch } } : m,
        ),
      })),
    )
  }

  const applyUploadResult = (id: number, res: PeerUploadResult) => {
    if (res.ok) {
      // "Đã gửi" chỉ khi bên nhận xác nhận (frame `file_state`), trước đó là đang gửi/chờ.
      patchMessageFile(id, {
        progress: 100,
        done: false,
        state: res.sentTo === 0 ? "waiting" : "sending",
        chunks: res.chunks,
        fileId: res.fileId,
        checksum: res.sha256 ? res.sha256.slice(0, 8).toUpperCase() : undefined,
      })
      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === id
              ? {
                  ...m,
                  clientId: m.clientId ?? (res.fileId ? `file:${res.fileId}` : undefined),
                  status: res.sentTo === 0 ? ("stored" as const) : ("sending" as const),
                }
              : m,
          ),
        })),
      )
      if (res.sentTo === 0) {
        pushToast("Đã xử lý file — đang chờ người nhận online để tải")
      }
    } else {
      patchMessageFile(id, { progress: 0, done: false, state: "failed" })
      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === id ? { ...m, status: "failed" as const, retryable: true } : m,
          ),
        })),
      )
      pushToast("Gửi file lỗi: " + (res.message || res.error || "unknown"))
    }
  }

  const uploadPeerFile = async (
    roomId: number,
    name: string,
    mime: string,
    buf: ArrayBuffer,
    onProgress?: (pct: number) => void,
    onFileId?: (fileId: string) => void,
  ): Promise<PeerUploadResult> => {
    const port = peerApiPortRef.current
    if (!port) return { ok: false, error: "NO_PEER_API" }
    const peer = peerRef.current
    if (!peer) return { ok: false, error: "NO_PEER" }
    // 1) Xin fileId + vé upload một lần (gắn user + Origin của phiên UI).
    const begin = await peer.beginFileUpload(roomId, name, mime, buf.byteLength)
    if (begin.type !== "file_begin_ok" || !begin.uploadToken) {
      return { ok: false, error: begin.error ?? "BEGIN_FAILED" }
    }
    if (begin.fileId && onFileId) {
      onFileId(begin.fileId)
    }
    const sha256 = await sha256Hex(buf)
    // 2) Bơm byte thô lên loopback — không qua khung WS 64KB.
    const qs = new URLSearchParams({ roomId: String(roomId), sha256 })
    return new Promise<PeerUploadResult>((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open(
        "POST",
        `http://127.0.0.1:${port}/files/upload/${encodeURIComponent(begin.uploadToken!)}?${qs.toString()}`,
      )
      xhr.responseType = "json"
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.max(1, Math.round((e.loaded / e.total) * 100)))
        }
      }
      xhr.onload = () => {
        const r = xhr.response as
          | {
              ok?: boolean
              fileId?: string
              sha256?: string
              chunks?: number
              sentTo?: number
              error?: string
              message?: string
            }
          | null
        if (xhr.status >= 200 && xhr.status < 300 && r?.ok) {
          resolve({ ok: true, fileId: r.fileId ?? begin.fileId, ...r })
        } else {
          resolve({
            ok: false,
            error: r?.error ?? `HTTP_${xhr.status}`,
            message: r?.message,
          })
        }
      }
      xhr.onerror = () => resolve({ ok: false, error: "NETWORK" })
      xhr.send(buf)
    })
  }

  /** Gắn URL blob cục bộ vào đúng thẻ tệp (ảnh/video xem trước ngay sau khi nhận). */
  const setFileUrl = (roomId: number, id: number, url: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.realId === roomId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === id && m.file ? { ...m, file: { ...m.file, url } } : m,
              ),
            }
          : c,
      ),
    )
  }

  const setFileUrlByClient = (roomId: number, clientId: string, url: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.realId === roomId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.clientId === clientId && m.file
                  ? { ...m, file: { ...m.file, url } }
                  : m,
              ),
            }
          : c,
      ),
    )
  }

  const handlePeerFile = (f: PeerUiFrame) => {
    const roomId = f.roomId
    if (roomId === undefined) return
    if (f.fileId) {
      const conv = conversationsRef.current.find((c) => c.realId === roomId)
      if (conv?.messages.some((m) => m.file?.fileId === f.fileId)) return
    }
    const mine = meId > 0 && f.fromUserId === meId
    const mime = f.mime || "application/octet-stream"
    const isImage = mime.startsWith("image/")
    const isVideo = mime.startsWith("video/")
    const isAudio =
      mime.startsWith("audio/") ||
      (f.name != null &&
        (f.name.endsWith(".webm") ||
          f.name.endsWith(".ogg") ||
          f.name.endsWith(".mp3") ||
          f.name.endsWith(".wav") ||
          f.name.endsWith(".m4a")))
    const voiceDur = f.name?.match(/_d(\d+)\./)
    const duration = voiceDur ? parseInt(voiceDur[1], 10) : 0
    let url: string | undefined
    if (f.ok && f.dataB64) {
      if (isImage) {
        url = `data:${mime};base64,${f.dataB64}`
      } else {
        try {
          const bin = atob(f.dataB64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          url = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }))
        } catch {}
      }
    }
    const conv = conversationsRef.current.find((c) => c.realId === roomId)
    const sender = conv?.members?.find((m) => m.id === f.fromUserId)
    const senderName = sender?.name || f.fromUsername
    const senderInitials =
      sender?.initials ||
      (senderName ? makeInitials(senderName, senderName) : undefined)

    const nm: Message = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      clientId: f.fileId ? `file:${f.fileId}` : undefined,
      text: isAudio ? "Đã gửi một tin nhắn thoại" : (f.name ?? "file"),
      fromMe: mine,
      time: formatClock(Date.now()),
      status: "delivered",
      sentAt: Date.now(),
      senderId: f.fromUserId,
      senderName,
      senderInitials,
      voice: isAudio ? { url: url || "", duration } : undefined,
      file: isAudio
        ? undefined
        : {
            name: f.name ?? "file",
            size: formatBytes(f.size ?? 0),
            progress: f.ok ? 100 : 0,
            done: !!f.ok,
            isImage: isImage || undefined,
            isVideo: isVideo || undefined,
            url,
            chunks: f.chunks,
            fileId: f.fileId,
            mime,
            checksum: f.sha256 ? f.sha256.slice(0, 8).toUpperCase() : undefined,
          },
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.realId === roomId
          ? {
              ...c,
              messages: [...c.messages, nm],
              lastMessage: isAudio
                ? `${mine ? "Đã gửi" : "Đã nhận"}: Tin nhắn thoại`
                : `${mine ? "Đã gửi" : "Đã nhận"}: ${nm.text}`,
              time: nm.time,
              lastAt: Date.now(),
              unread:
                mine || selectedRoomIdRef.current === c.realId
                  ? c.unread ?? 0
                  : (c.unread ?? 0) + 1,
            }
          : c,
      ),
    )
    if (!f.ok && !mine) {
      pushToast(`File "${f.name}" lỗi toàn vẹn: ${f.code ?? "checksum"}`)
    }
    if (!url && f.fileId && (isImage || isVideo || isAudio)) {
      void openPeerFile(f.fileId).then((r) => {
        if (r.url) {
          if (isAudio) {
            setConversations((prev) =>
              prev.map((c) =>
                c.realId === roomId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === nm.id
                          ? { ...m, voice: { url: r.url!, duration: m.voice?.duration ?? duration } }
                          : m,
                      ),
                    }
                  : c,
              ),
            )
          } else {
            setFileUrl(roomId, nm.id, r.url)
          }
        }
      })
    }
  }

  /**
   * Mở một tệp đã lưu trên Core cục bộ: xin vé tải một lần rồi GET byte thô.
   * Trả URL blob để hiển thị/tải xuống — vé không bao giờ lộ ra ngoài.
   */
  const openPeerFile = async (fileId: string): Promise<{ url?: string; error?: string }> => {
    const peer = peerRef.current
    const port = peerApiPortRef.current
    if (!peer || !port) return { error: "NO_PEER" }
    const t = await peer.openFile(fileId)
    if (t.type !== "file_ticket_ok" || !t.ticket) {
      return { error: t.error ?? "TICKET_FAILED" }
    }
    const url = `http://127.0.0.1:${port}/files/${encodeURIComponent(fileId)}?ticket=${encodeURIComponent(t.ticket)}`
    try {
      const r = await fetch(url)
      if (!r.ok) return { error: `HTTP_${r.status}` }
      return { url: URL.createObjectURL(await r.blob()) }
    } catch {
      return { error: "NETWORK" }
    }
  }

  /** Hủy gửi/nhận tệp (Core dừng, gửi `file_cancel` cho phía bên kia). */
  const cancelPeerFile = (fileId: string) => {
    const peer = peerRef.current
    if (!peer) return
    peer.cancelFile(fileId)
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.file?.fileId === fileId && !m.file.done
            ? { ...m, file: { ...m.file, state: "cancelled" as const } }
            : m,
        ),
      })),
    )
  }

  /** Gửi lại tệp đã hủy/lỗi từ dữ liệu Core còn giữ trên đĩa. */
  const retryPeerFile = (fileId: string) => {
    const peer = peerRef.current
    if (!peer) return
    peer.retryFile(fileId)
    setConversations((prev) =>
      prev.map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.file?.fileId === fileId
            ? { ...m, file: { ...m.file, state: "sending" as const } }
            : m,
        ),
      })),
    )
  }

  /**
   * Peer Core báo trạng thái tệp ĐANG GỬI (theo fileId):
   * `sent` = bên nhận đã ghép xong + SHA khớp; `waiting` = tạm dừng vì chưa có đường/ACK.
   */
  const handlePeerFileState = (f: PeerUiFrame) => {
    if (!f.fileId) return
    const state = f.state
    setConversations((prev) =>
      prev.map((c) => {
        let changed = false
        const messages = c.messages.map((m) => {
          if (!m.file || (m.file.fileId !== f.fileId && m.clientId !== `file:${f.fileId}`)) return m
          changed = true
          if (state === "sent") {
            return {
              ...m,
              status: "sent" as const,
              file: {
                ...m.file,
                done: true,
                progress: 100,
                state: "sent" as const,
                checksum: f.sha256 ? f.sha256.slice(0, 8).toUpperCase() : m.file.checksum,
                sentTo: typeof f.sentTo === "number" ? f.sentTo : m.file.sentTo,
                total: typeof f.total === "number" ? f.total : m.file.total,
              },
            }
          }
          if (state === "failed" || state === "cancelled") {
            return {
              ...m,
              status: "failed" as const,
              retryable: true,
              file: {
                ...m.file,
                done: false,
                progress: 0,
                state: state === "cancelled" ? ("cancelled" as const) : ("failed" as const),
                weak: false,
              },
            }
          }
          if (state === "waiting") {
            return {
              ...m,
              status: "stored" as const,
              file: { ...m.file, state: "waiting" as const, weak: false },
            }
          }
          return {
            ...m,
            file: {
              ...m.file,
              state: "sending" as const,
              weak: Boolean(f.weak),
              sentTo: typeof f.sentTo === "number" ? f.sentTo : m.file.sentTo,
              total: typeof f.total === "number" ? f.total : m.file.total,
              recipients: f.recipients ?? m.file.recipients,
            },
          }
        })
        return changed ? { ...c, messages } : c
      }),
    )
    if (state === "failed") {
      pushToast(`Gửi tệp thất bại (mã ${f.code ?? "checksum"})`)
    }
  }

  const sendMessage = () => {
    if (!messageInput.trim()) return
    if (!canSend()) return
    if (editingId !== null) {
      const orig = selected.messages.find((m) => m.id === editingId)
      const text = messageInput.trim()
      updateMessage(editingId, { text, edited: true })
      if (selected.realId !== undefined && orig?.clientId) {
        if (peerOnRef.current) {
          peerRef.current?.send({
            type: "edit",
            roomId: selected.realId,
            clientId: orig.clientId,
            text,
          })
        }
        api.editMessage(selected.realId, orig.clientId).then((r) => {
          if (!r.ok) {
            pushToast("Máy chủ chưa xác nhận chỉnh sửa — có thể mất khi tải lại trang")
          } else if (r.data) {
            updateMessage(editingId, { edited: r.data.message.is_edited })
          }
        })
      }
      setEditingId(null)
      setEditText("")
      setMessageInput("")
      pushToast("Đã lưu nội dung chỉnh sửa")
      return
    }
    const time = now()
    const id = Date.now()
    const clientId = genClientId()
    const replyTarget =
      replyToId !== null
        ? selected.messages.find((m) => m.id === replyToId)
        : undefined
    const newMsg: Message = {
      id,
      clientId,
      text: messageInput.trim(),
      fromMe: true,
      time,
      status: selected.realId !== undefined ? "sending" : "sent",
      sentAt: Date.now(),
      replyId: replyToId ?? undefined,
      replyToClientId: replyTarget?.clientId,
      decrypted: true,
    }
    const optimistic = mergePendingStatus(
      pendingStatusRef.current,
      selected.realId,
      newMsg,
    )
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [...c.messages, optimistic],
              lastMessage: optimistic.text,
              time,
              lastAt: Date.now(),
              unread: 0,
            }
          : c,
      ),
    )
    if (selected.realId !== undefined) {
      const realId = selected.realId
      if (!selected.online) {
        if (peerState !== "on")
          pushToast("Peer Core chưa bật — tin sẽ ở trạng thái chờ")
        else if (e2eState !== "unlocked")
          pushToast("Chưa mở khoá E2E — cần mở khoá để gửi tin ngoại tuyến")
      }
      api
        .sendMessage(realId, {
          client_msg_id: clientId,
          text: "",
          reply_to_client_id: replyTarget?.clientId,
        })
        .then((r) => {
          if (!r.ok && peerState !== "on") {
            patchRoomMsg(realId, clientId, (m) => ({ ...m, status: "failed" }))
          }
        })
        .catch(() => {
          if (peerState !== "on")
            patchRoomMsg(realId, clientId, (m) => ({ ...m, status: "failed" }))
        })
      dbg("gửi tin", realId, shortCid(clientId), peerState === "on" ? "mesh" : "no-peercore")
      if (peerState === "on" && peerRef.current) {
        peerRef.current.send({
          type: "send",
          roomId: realId,
          text: newMsg.text,
          clientId,
          replyToClientId: replyTarget?.clientId,
        })
      }
      // Lưới an toàn: Core/Tracker chậm thì không để "Đang gửi…" vĩnh viễn.
      window.setTimeout(() => {
        const cur = conversationsRef.current
          .find((c) => c.realId === realId)
          ?.messages.find((m) => m.clientId === clientId)
        if (cur?.status === "sending") {
          dbg("send_state timeout", realId, shortCid(clientId))
          patchRoomMsg(realId, clientId, (m) => ({ ...m, status: "stored" }))
          peerRef.current?.retryMessage(clientId)
        }
      }, SEND_STATE_TIMEOUT_MS)
    }
    setMessageInput("")
    setReplyToId(null)
  }

  const retryOutgoing = (roomId: number | undefined, clientId: string | undefined) => {
    if (!clientId) return
    if (peerState !== "on" || !peerRef.current) {
      pushToast("Peer Core chưa bật — không thể gửi lại lúc này")
      return
    }
    if (roomId !== undefined) {
      patchRoomMsg(roomId, clientId, (m) => ({ ...m, retryable: false }))
    }
    peerRef.current.retryMessage(clientId)
  }

  const sendLike = () => {
    if (!canSend()) return
    const time = now()
    const id = Date.now()
    const clientId = genClientId()
    const emojiText = selected.favEmoji ?? themeIcon(selected)
    const replyTarget =
      replyToId !== null
        ? selected.messages.find((m) => m.id === replyToId)
        : undefined
    const likeMsg: Message = {
      id,
      clientId,
      text: emojiText,
      fromMe: true,
      time,
      status: selected.realId !== undefined ? "sending" : "sent",
      sentAt: Date.now(),
      like: true,
      replyId: replyToId ?? undefined,
      replyToClientId: replyTarget?.clientId,
      decrypted: true,
    }
    const optimistic = mergePendingStatus(
      pendingStatusRef.current,
      selected.realId,
      likeMsg,
    )
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [...c.messages, optimistic],
              lastMessage: optimistic.text,
              time,
              lastAt: Date.now(),
              unread: 0,
            }
          : c,
      ),
    )
    if (replyToId !== null) cancelReply()
    if (selected.realId !== undefined) {
      const realId = selected.realId
      if (!selected.online) {
        if (peerState !== "on")
          pushToast("Peer Core chưa bật — tin sẽ ở trạng thái chờ")
        else if (e2eState !== "unlocked")
          pushToast("Chưa mở khoá E2E — cần mở khoá để gửi tin ngoại tuyến")
      }
      api
        .sendMessage(realId, {
          client_msg_id: clientId,
          text: "",
          reply_to_client_id: replyTarget?.clientId,
        })
        .then((r) => {
          if (!r.ok && peerState !== "on") {
            patchRoomMsg(realId, clientId, (m) => ({ ...m, status: "failed" }))
          }
        })
        .catch(() => {
          if (peerState !== "on")
            patchRoomMsg(realId, clientId, (m) => ({ ...m, status: "failed" }))
        })
      dbg("gửi like", realId, shortCid(clientId), peerState === "on" ? "mesh" : "no-peercore")
      const payloadText = JSON.stringify({ kind: "like", emoji: emojiText })
      if (peerState === "on" && peerRef.current) {
        peerRef.current.send({
          type: "send",
          roomId: realId,
          text: payloadText,
          clientId,
          replyToClientId: replyTarget?.clientId,
        })
      }
      const safeRoomId = realId
      const safeCid = clientId
      const ackTimer = setTimeout(() => {
        outgoingAcksRef.current.delete(safeCid)
        patchRoomMsg(safeRoomId, safeCid, (m) =>
          m.status === "sending"
            ? { ...m, status: peerState === "on" ? "sent" : "failed", retryable: peerState !== "on" }
            : m,
        )
      }, 5000)
      outgoingAcksRef.current.set(safeCid, ackTimer)
    }
  }

  const sendVoice = (url = recUrl, duration = recDuration) => {
    if (!url) return
    if (!canSend()) {
      URL.revokeObjectURL(url)
      clearRecordedVoice()
      return
    }
    const replyTarget =
      replyToId !== null
        ? selected.messages.find((m) => m.id === replyToId)
        : undefined
    const time = now()
    const id = Date.now()
    const cleanDuration = Math.max(1, Math.round(duration))
    const realId = selected.realId
    const newMsg: Message = {
      id,
      text: "Đã gửi một tin nhắn thoại",
      fromMe: true,
      time,
      status: realId !== undefined ? "sending" : "sent",
      sentAt: Date.now(),
      voice: { url, duration: cleanDuration },
      replyId: replyToId ?? undefined,
      replyToClientId: replyTarget?.clientId,
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [...c.messages, newMsg],
              lastMessage: "Tin nhắn thoại",
              time,
              lastAt: Date.now(),
              unread: 0,
            }
          : c,
      ),
    )
    clearRecordedVoice()
    setReplyToId(null)

    if (realId !== undefined && peerApiPortRef.current) {
      void fetch(url)
        .then((r) => r.blob())
        .then(async (blob) => {
          const buf = await blob.arrayBuffer()
          const voiceName = `voice_${Date.now()}_d${cleanDuration}.webm`
          const mime = blob.type || "audio/webm"
          const res = await uploadPeerFile(
            realId,
            voiceName,
            mime,
            buf,
            undefined,
            (fId) => {
              setConversations((prev) =>
                prev.map((c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === id ? { ...m, clientId: m.clientId ?? `file:${fId}` } : m,
                  ),
                })),
              )
              if (realId !== undefined) {
                api
                  .sendMessage(realId, {
                    client_msg_id: `file:${fId}`,
                    text: "",
                    type: "voice",
                    reply_to_client_id: replyTarget?.clientId,
                  })
                  .catch(() => {})
              }
            },
          )
          if (res.ok) {
            updateMessage(id, { status: "sent" })
          } else {
            updateMessage(id, { status: "failed" })
            pushToast(`Gửi tin nhắn thoại lỗi: ${res.message || res.error || "Không thể gửi"}`)
          }
        })
        .catch(() => {
          updateMessage(id, { status: "failed" })
        })
    }
  }

  const sendFile = async (file: File) => {
    if (!canSend()) return
    const replyTarget =
      replyToId !== null
        ? selected.messages.find((m) => m.id === replyToId)
        : undefined

    // 1. Kiểm tra file rỗng
    if (file.size <= 0) {
      pushToast("File rỗng (0 byte)")
      return
    }

    // 2. Chuẩn hóa tên file
    const nameCheck = sanitizeFileName(file.name)
    if (!nameCheck.ok) {
      pushToast(nameCheck.error || "Tên file không hợp lệ")
      return
    }
    const cleanName = nameCheck.name

    // 3. Kiểm tra phần mở rộng & đuôi cấm/đuôi kép
    const extCheck = validateFileExtension(cleanName)
    if (!extCheck.ok) {
      pushToast(extCheck.error || "Loại file không được hỗ trợ")
      return
    }

    // 4. Kiểm tra kích thước theo loại phòng
    const isGroup = selected.isGroup === true || (selected.members && selected.members.length > 2)
    const sizeCheck = validateFileSize(file.size, !!isGroup, true)
    if (!sizeCheck.ok) {
      pushToast(sizeCheck.error || "File quá lớn")
      return
    }

    // 5. Kiểm tra magic bytes
    try {
      const headBuf = await file.slice(0, 64).arrayBuffer()
      const magicCheck = inspectMagicBytes(new Uint8Array(headBuf), cleanName)
      if (!magicCheck.ok) {
        pushToast(magicCheck.error || "Nội dung file không hợp lệ")
        return
      }
    } catch {
      // nếu không đọc được slice thì bỏ qua
    }

    const time = now()
    const id = Date.now()
    const chunks = Math.max(1, Math.ceil(file.size / 32768))
    const newMsg: Message = {
      id,
      text: cleanName,
      fromMe: true,
      time,
      status: selected.realId !== undefined ? "sending" : "sent",
      sentAt: Date.now(),
      file: {
        name: cleanName,
        size: formatBytes(file.size),
        progress: 0,
        done: false,
        chunks,
        checksum: "…",
      },
      replyId: replyToId ?? undefined,
      replyToClientId: replyTarget?.clientId,
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [...c.messages, newMsg],
              lastMessage: `Đã gửi: ${cleanName}`,
              time,
              lastAt: Date.now(),
              unread: 0,
            }
          : c,
      ),
    )
    const realId = selected.realId
    if (realId !== undefined && peerApiPortRef.current) {
      void file.arrayBuffer().then((buf) =>
        uploadPeerFile(
          realId,
          cleanName,
          file.type || "application/octet-stream",
          buf,
          (pct) => patchMessageFile(id, { progress: pct }),
          (fId) => {
            patchMessageFile(id, { fileId: fId })
            setConversations((prev) =>
              prev.map((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === id ? { ...m, clientId: m.clientId ?? `file:${fId}` } : m,
                ),
              })),
            )
            if (realId !== undefined) {
              api
                .sendMessage(realId, {
                  client_msg_id: `file:${fId}`,
                  text: "",
                  type: "file",
                  reply_to_client_id: replyTarget?.clientId,
                })
                .catch(() => {})
            }
          },
        ).then((res) => applyUploadResult(id, res)),
      )
    } else {
      const timer = window.setInterval(() => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== id || !m.file || m.file.done) return m
                    const next = Math.min(100, m.file.progress + 18)
                    const done = next >= 100
                    if (done) window.clearInterval(timer)
                    return {
                      ...m,
                      file: { ...m.file, progress: next, done },
                    }
                  }),
                }
              : c,
          ),
        )
      }, 400)
    }
    setReplyToId(null)
  }

  const sendImage = (img: {
    name: string
    size: number
    url: string
    kind?: "image" | "video"
    duration?: number
  }) => {
    if (!canSend()) return
    const replyTarget =
      replyToId !== null
        ? selected.messages.find((m) => m.id === replyToId)
        : undefined
    const isGroup = selected.isGroup === true || (selected.members && selected.members.length > 2)
    const sizeCheck = validateFileSize(img.size, !!isGroup, true)
    if (!sizeCheck.ok) {
      pushToast(sizeCheck.error || "Tệp vượt quá dung lượng cho phép")
      return
    }
    const time = now()
    const id = Date.now()
    const chunks = Math.max(1, Math.ceil(img.size / 32768))
    const isVideo = img.kind === "video"
    const newMsg: Message = {
      id,
      text: img.name,
      fromMe: true,
      time,
      status: selected.realId !== undefined ? "sending" : "sent",
      sentAt: Date.now(),
      file: {
        name: img.name,
        size: formatBytes(img.size),
        progress: 0,
        done: false,
        isImage: isVideo ? undefined : true,
        isVideo,
        duration: isVideo ? img.duration : undefined,
        url: img.url,
        chunks,
        checksum: "…",
      },
      replyId: replyToId ?? undefined,
      replyToClientId: replyTarget?.clientId,
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: [...c.messages, newMsg],
              lastMessage: `Đã gửi: ${img.name}`,
              time,
              lastAt: Date.now(),
              unread: 0,
            }
          : c,
      ),
    )
    const realId = selected.realId
    if (realId !== undefined && peerApiPortRef.current) {
      void fetch(img.url)
        .then((r) => r.blob())
        .then(async (blob) => {
          const buf = await blob.arrayBuffer()
          const res = await uploadPeerFile(
            realId,
            img.name,
            blob.type || (isVideo ? "video/mp4" : "image/png"),
            buf,
            (pct) => patchMessageFile(id, { progress: pct }),
            (fId) => {
              patchMessageFile(id, { fileId: fId })
              setConversations((prev) =>
                prev.map((c) => ({
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === id ? { ...m, clientId: m.clientId ?? `file:${fId}` } : m,
                  ),
                })),
              )
              if (realId !== undefined) {
                api
                  .sendMessage(realId, {
                    client_msg_id: `file:${fId}`,
                    text: "",
                    type: isVideo ? "video" : "image",
                    reply_to_client_id: replyTarget?.clientId,
                  })
                  .catch(() => {})
              }
            },
          )
          applyUploadResult(id, res)
        })
        .catch(() => patchMessageFile(id, { progress: 100, done: true }))
    } else {
      const timer = window.setInterval(() => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== id || !m.file || m.file.done) return m
                    const next = Math.min(100, m.file.progress + 22)
                    const done = next >= 100
                    if (done) window.clearInterval(timer)
                    return {
                      ...m,
                      file: { ...m.file, progress: next, done },
                    }
                  }),
                }
              : c,
          ),
        )
      }, 350)
    }
    setReplyToId(null)
  }

  const confirmSendMedia = () => {
    if (!mediaPreview) return
    mediaPreview.forEach((img) => sendImage(img))
    setMediaPreview(null)
    setPreviewPlayUrl(null)
  }

  const cancelMediaPreview = () => {
    mediaPreview?.forEach((img) => URL.revokeObjectURL(img.url))
    setMediaPreview(null)
    setPreviewPlayUrl(null)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const countCheck = validateFileCount(files.length)
    if (!countCheck.ok) {
      pushToast(countCheck.error || "Quá nhiều file")
      e.target.value = ""
      return
    }
    files.forEach((f) => void sendFile(f))
    e.target.value = ""
  }

  const handleImageInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const countCheck = validateFileCount(files.length)
    if (!countCheck.ok) {
      pushToast(countCheck.error || "Quá nhiều file")
      e.target.value = ""
      return
    }
    const items: {
      name: string
      size: number
      url: string
      kind: "image" | "video"
      duration?: number
    }[] = []

    for (const f of files) {
      const isVideo = f.type.startsWith("video/")
      const isImg = f.type.startsWith("image/")
      if (!isVideo && !isImg) {
        sendFile(f)
        continue
      }
      if (isImg) {
        if (isSvg(f.name, f.type)) {
          pushToast("Không hỗ trợ định dạng SVG vì lý do an toàn")
          continue
        }
        const v = validateImageSize(f.size)
        if (!v.ok) {
          pushToast(v.error || "Ảnh quá lớn")
          continue
        }
        try {
          const processed = await compressImage(f, f.name, {
            maxDim: 2048,
            quality: 0.85,
            maxImageMb: getFileLimits().maxImageMb,
            createThumbnail: true,
          })
          const url = URL.createObjectURL(processed.blob)
          items.push({
            name: f.name,
            size: processed.compressedSize,
            url,
            kind: "image",
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Lỗi xử lý ảnh"
          pushToast(msg)
        }
        continue
      }
      if (isVideo) {
        const isGroup = selected.isGroup === true || (selected.members && selected.members.length > 2)
        const sizeCheck = validateFileSize(f.size, !!isGroup, true)
        if (!sizeCheck.ok) {
          pushToast(sizeCheck.error || "Video quá lớn")
          continue
        }
        const item = {
          name: f.name,
          size: f.size,
          url: URL.createObjectURL(f),
          kind: "video" as const,
        }
        items.push(item)
        readVideoMeta(item.url, (sec) =>
          setMediaPreview((prev) =>
            prev
              ? prev.map((p) =>
                  p.url === item.url ? { ...p, duration: sec } : p,
                )
              : prev,
          ),
        )
      }
    }
    if (items.length > 0) setMediaPreview((prev) => [...(prev ?? []), ...items])
    e.target.value = ""
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes("Files")) {
      dragCounterRef.current += 1
      setDragOver(true)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDragLeave = () => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    const media = files.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    )
    const items: {
      name: string
      size: number
      url: string
      kind: "image" | "video"
      duration?: number
    }[] = []
    media.forEach((f) => {
      const kind: "video" | "image" = f.type.startsWith("video/") ? "video" : "image"
      if (kind === "video") {
        const isGroup = selected.isGroup === true || (selected.members && selected.members.length > 2)
        const sizeCheck = validateFileSize(f.size, !!isGroup, true)
        if (!sizeCheck.ok) {
          pushToast(sizeCheck.error || "Video quá lớn")
          return
        }
      }
      const item = {
        name: f.name,
        size: f.size,
        url: URL.createObjectURL(f),
        kind,
      }
      items.push(item)
      if (kind === "video") {
        readVideoMeta(item.url, (sec) =>
          setMediaPreview((prev) =>
            prev
              ? prev.map((p) =>
                  p.url === item.url ? { ...p, duration: sec } : p,
                )
              : prev,
          ),
        )
      }
    })
    if (items.length > 0) setMediaPreview((prev) => [...(prev ?? []), ...items])
    files
      .filter(
        (f) => !f.type.startsWith("image/") && !f.type.startsWith("video/"),
      )
      .forEach(sendFile)
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    atBottomRef.current = atBottom
    if (el.scrollTop < 64) maybeLoadMoreHistory()
  }

  const maybeLoadMoreHistory = () => {
    const roomId = selectedRoomIdRef.current
    if (roomId === undefined || !peerOnRef.current) return
    if (historyLoadingRef.current) return
    if (!historyHasMore[roomId]) return
    const conv = conversationsRef.current.find((c) => c.realId === roomId)
    if (!conv) return
    const oldest = conv.messages.reduce(
      (mn, m) => Math.min(mn, m.sentAt ?? Number.MAX_SAFE_INTEGER),
      Number.MAX_SAFE_INTEGER,
    )
    if (!Number.isFinite(oldest)) return
    prependHeightRef.current = scrollRef.current?.scrollHeight ?? null
    pullLocalHistory(roomId, oldest)
  }

  const jumpToBottom = () => {
    atBottomRef.current = true
    setShowJump(false)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  const jumpToMessage = (id: number) => {
    setJumpId(id)
    const el = document.getElementById("msg-" + id)
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    window.setTimeout(() => setJumpId((cur) => (cur === id ? null : cur)), 1000)
  }

  const startEdit = (msg: Message) => {
    setEditingId(msg.id)
    setEditText(msg.text)
    setMessageInput(msg.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText("")
    setMessageInput("")
  }

  const startReply = (msg: Message) => {
    setEditingId(null)
    setReplyToId(msg.id)
    window.setTimeout(() => messageInputRef.current?.focus(), 0)
  }

  const cancelReply = () => setReplyToId(null)

  const recallEveryone = (id: number) => {
    const msg = selected.messages.find((m) => m.id === id)
    const cid = msg?.clientId || (msg?.file?.fileId ? `file:${msg.file.fileId}` : undefined)
    updateMessage(id, {
      recalled: true,
      text: "",
      file: undefined,
      reactions: undefined,
    })
    if (selected.realId !== undefined && cid) {
      if (peerOnRef.current) {
        peerRef.current?.send({
          type: "recall",
          roomId: selected.realId,
          clientId: cid,
        })
      }
      api.recallMessage(selected.realId, cid).then((r) => {
        if (r.ok && r.data) {
          updateMessage(id, {
            recalled: r.data.message.is_recalled_all,
            text: r.data.message.content,
            edited: r.data.message.is_edited,
            file: undefined,
          })
        } else {
          pushToast("Máy chủ chưa xác nhận thu hồi — có thể mất khi tải lại trang")
        }
      })
    }
    pushToast("Đã thu hồi tin nhắn cho mọi người")
  }

  const deleteForMe = (id: number) => {
    const msg = selected.messages.find((m) => m.id === id)
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: c.messages.filter((m) => m.id !== id),
            }
          : c,
      ),
    )
    if (selected.realId !== undefined && msg?.clientId) {
      api.deleteMessageForMe(selected.realId, msg.clientId).then((r) => {
        if (!r.ok)
          pushToast("Máy chủ chưa xác nhận xoá — có thể xuất hiện lại khi tải lại trang")
      })
    }
    pushToast("Đã xoá tin nhắn chỉ ở phía bạn")
  }

  const removeMyReaction = (msgId: number) => {
    const msg = selected.messages.find((m) => m.id === msgId)
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      reactions: (m.reactions ?? []).filter((r) => !r.mine),
                    }
                  : m,
              ),
            }
          : c,
      ),
    )
    const cid = msg?.clientId || (msg?.file?.fileId ? `file:${msg.file.fileId}` : undefined)
    if (selected.realId !== undefined && cid) {
      if (peerOnRef.current) {
        const myEmoji = msg.reactions?.find((r) => r.mine)?.emoji
        if (myEmoji) {
          peerRef.current?.send({
            type: "reaction",
            roomId: selected.realId,
            clientId: cid,
            emoji: myEmoji,
            remove: true,
          })
        }
      }
      api.removeReaction(selected.realId, cid)
    }
  }

  const toggleReaction = (id: number, emoji: string) => {
    const selfName = "Bạn"
    const selfInitials = "B"
    const msg = selected.messages.find((m) => m.id === id)
    const myCur = (msg?.reactions ?? []).find((r) => r.mine)
    const willLeave = myCur !== undefined && myCur.emoji === emoji
    const cid = msg?.clientId || (msg?.file?.fileId ? `file:${msg.file.fileId}` : undefined)
    if (selected.realId !== undefined && cid) {
      if (peerOnRef.current) {
        peerRef.current?.send({
          type: "reaction",
          roomId: selected.realId,
          clientId: cid,
          emoji,
          remove: willLeave,
        })
      }
      if (willLeave) api.removeReaction(selected.realId, cid)
      else api.setReaction(selected.realId, cid, emoji)
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== id) return m
                const mine = (m.reactions ?? []).find((r) => r.mine)
                if (mine) {
                  if (mine.emoji === emoji)
                    return {
                      ...m,
                      reactions: (m.reactions ?? []).filter((r) => !r.mine),
                    }
                  return {
                    ...m,
                    reactions: [
                      ...(m.reactions ?? []).filter((r) => !r.mine),
                      {
                        emoji,
                        name: mine.name,
                        initials: mine.initials,
                        mine: true,
                      },
                    ],
                  }
                }
                return {
                  ...m,
                  reactions: [
                    ...(m.reactions ?? []),
                    {
                      emoji,
                      name: selfName,
                      initials: selfInitials,
                      mine: true,
                    },
                  ],
                }
              }),
            }
          : c,
      ),
    )
  }

  const openShare = (msg: Message) => {
    setShareMsg(msg)
    setShareTargets([])
    setShareQuery("")
    setShareCaption("")
  }

  const toggleShareTarget = (id: number) => {
    setShareTargets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const sendShared = () => {
    if (!shareMsg || shareTargets.length === 0) return
    const time = now()
    const caption = shareCaption.trim()
    const body = caption ? `${caption}\n${shareMsg.text}` : shareMsg.text
    const ids = shareTargets.map(() => Date.now() + Math.random())
    const newCids = shareTargets.map(() => genClientId())
    const sourceClientId = shareMsg.clientId
    setConversations((prev) =>
      prev.map((c) => {
        const idx = shareTargets.indexOf(c.id)
        if (idx === -1) return c
        const fwd: Message = {
          id: ids[idx],
          clientId: newCids[idx],
          text: body,
          file: shareMsg.file,
          fromMe: true,
          time,
          status: sourceClientId ? "sending" : "sent",
          sentAt: Date.now(),
          forwarded: true,
          decrypted: true,
        }
        return {
          ...c,
          messages: [...c.messages, fwd],
          lastMessage: body,
          time,
          lastAt: Date.now(),
          unread: 0,
        }
      }),
    )
    shareTargets.forEach((targetId, idx) => {
      const conv = conversations.find((c) => c.id === targetId)
      if (!conv || conv.realId === undefined) return
      const newCid = newCids[idx]
      if (peerOnRef.current) {
        peerRef.current?.send({
          type: "send",
          roomId: conv.realId,
          text: body,
          clientId: newCid,
        })
      }
      if (sourceClientId) {
        api
          .forwardMessage(conv.realId, {
            client_msg_id: newCid,
            forwarded_from_client_id: sourceClientId,
          })
          .then((r) => {
            const optId = ids[idx]
            if (r.ok) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetId
                    ? {
                        ...c,
                        messages: c.messages.map((x) =>
                          x.id === optId ? { ...x, status: "sent" } : x,
                        ),
                      }
                    : c,
                ),
              )
            } else {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetId
                    ? {
                        ...c,
                        messages: c.messages.map((x) =>
                          x.id === optId ? { ...x, status: "failed" } : x,
                        ),
                      }
                    : c,
                ),
              )
              pushToast("Máy chủ chưa xác nhận chia sẻ — có thể mất khi tải lại trang")
            }
          })
      } else {
        api
          .sendMessage(conv.realId, {
            client_msg_id: newCid,
            text: body,
          })
          .then((r) => {
            const optId = ids[idx]
            if (r.ok) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetId
                    ? {
                        ...c,
                        messages: c.messages.map((x) =>
                          x.id === optId ? { ...x, status: "sent" } : x,
                        ),
                      }
                    : c,
                ),
              )
            }
          })
      }
    })
    pushToast("Đã chia sẻ tin nhắn")
    setShareMsg(null)
    setShareTargets([])
    setShareCaption("")
    setShareQuery("")
  }

  return {
    messageInput,
    setMessageInput,
    replyToId,
    setReplyToId,
    jumpId,
    setJumpId,
    emojiOpen,
    setEmojiOpen,
    emojiQuery,
    setEmojiQuery,
    emojiTab,
    setEmojiTab,
    recentEmojis,
    insertEmojiAtCursor,
    seenModalMsg,
    setSeenModalMsg,
    typing,
    setTyping,
    dragOver,
    historyHasMore,
    mediaPreview,
    setMediaPreview,
    previewPlayUrl,
    setPreviewPlayUrl,
    editingId,
    setEditingId,
    editText,
    setEditText,
    shareMsg,
    setShareMsg,
    shareTargets,
    setShareTargets,
    shareQuery,
    setShareQuery,
    shareCaption,
    setShareCaption,
    activeActionsId,
    setActiveActionsId,
    reactionMsgId,
    setReactionMsgId,
    reactionTab,
    setReactionTab,
    peerReady,
    canSend,
    updateMessage,
    patchRoomMsg,
    applySendState,
    handlePeerEdit,
    handlePeerRecall,
    handlePeerReaction,
    handlePeerPresence,
    markRoomRead,
    handlePeerSeen,
    handlePeerTyping,
    historyLoading,
    handleDecryptBatch,
    reDecryptPendingMessages,
    pullLocalHistory,
    insertOfflineMsg,
    handlePeerOffline,
    handlePeerHistory,
    handlePeerChat,
    handlePeerFile,
    handlePeerFileState,
    openPeerFile,
    cancelPeerFile,
    retryPeerFile,
    sendMessage,
    retryOutgoing,
    sendLike,
    sendVoice,
    sendFile,
    sendImage,
    confirmSendMedia,
    cancelMediaPreview,
    handleFileInput,
    handleImageInput,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleScroll,
    jumpToBottom,
    jumpToMessage,
    startEdit,
    cancelEdit,
    startReply,
    cancelReply,
    recallEveryone,
    deleteForMe,
    removeMyReaction,
    toggleReaction,
    openShare,
    toggleShareTarget,
    sendShared,
  }
}
