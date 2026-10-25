import { useState, useEffect, useRef } from "react"
import type { RoomMember } from "../../components/CreateRoomModal"
import {
  type FriendRequest,
  type Message,
  type Conversation,
  ROOM_ID_OFFSET,
} from "../../types/chat"
import { initialsOf } from "../chat/bubbles/VoiceBubble"
import { resolvePresence } from "../../lib/presenceLabel"
import { callPreviewText } from "../../lib/conversationPreview"
import { parseAnyLink } from "../../lib/link"
import {
  api,
  type ApiMessage,
  type ApiRoom,
} from "../../lib/api"

export function callLabel(
  kind: "voice" | "video",
  dir: "out" | "in",
  duration: number,
  outcome:
    | "completed"
    | "missed"
    | "rejected"
    | "cancelled"
    | "no-answer"
    | "ongoing"
    | "busy"
    | "unreachable",
): string {
  return callPreviewText({ type: kind, dir, duration, outcome })
}

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`
}

export function nowTime(): string {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`
}

export function genClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

interface UseRoomManagementOptions {
  meId: number
  meIdRef: React.MutableRefObject<number>
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
  selectedId: number
  setSelectedId: (id: number) => void
  conversationsRef: React.MutableRefObject<Conversation[]>
  pullLocalHistory: (roomId: number, before?: number) => void
  markRoomRead: (roomId: number, clientMsgId?: string) => void
  pushToast: (text: string) => void
  onLogout: () => void
  setRoomInfoOpen: (open: boolean) => void
  setShowCreateRoom: (show: boolean) => void
  setShowFindFriends: (show: boolean) => void
  setFindSeed: (seed: any) => void
  onInviteConsumed?: () => void
}

export function useRoomManagement({
  meId,
  meIdRef,
  conversations,
  setConversations,
  selectedId,
  setSelectedId,
  conversationsRef,
  pullLocalHistory,
  markRoomRead,
  pushToast,
  onLogout,
  setRoomInfoOpen,
  setShowCreateRoom,
  setShowFindFriends,
  setFindSeed,
  onInviteConsumed,
}: UseRoomManagementOptions) {
  const [friendList, setFriendList] = useState<RoomMember[]>([])
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([])
  const [friendReqOpen, setFriendReqOpen] = useState(false)
  const [inviteTab, setInviteTab] = useState<"friends" | "rooms">("friends")
  const [joinCode, setJoinCode] = useState("")
  const [joining, setJoining] = useState(false)

  // Tin nhắn từ server → model UI. reply_to_client_id (chuỗi) nối lại replyId (số)
  // bằng clientId của tin gốc đang có trong phiên.
  const apiMessageToMessage = (m: ApiMessage, local: Message[]): Message => {
    const mine = m.sender_id === meId
    let kind: "chat" | "call" = "chat"
    let callData: any = undefined
    if (m.type === "voice" || m.type === "video" || m.type === "call") {
      kind = "call"
      callData = {
        type: m.type === "video" ? "video" : "voice",
        dir: mine ? "out" : "in",
        duration: 0,
        outcome: "completed",
        startedAt: m.sent_at,
        endedAt: m.sent_at,
        starterId: mine ? meId : m.sender_id,
      }
    }
    if (m.content && m.content.startsWith('{"kind":"call"')) {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed.kind === "call" && parsed.call) {
          kind = "call"
          callData = parsed.call
        }
      } catch {}
    }
    return {
      id: m.id,
      clientId: m.client_msg_id,
      fromMe: mine,
      text: m.content || "",
      kind,
      call: callData,
      decrypted: false,
      time: formatClock(m.sent_at),
      status: mine
        ? m.seen_by && m.seen_by.length > 0
          ? "seen"
          : "sent"
        : "delivered",
      sentAt: m.sent_at,
      senderId: m.sender_id,
      senderName: mine ? undefined : m.sender_name,
      senderInitials: mine
        ? undefined
        : initialsOf(m.sender_name || m.sender_username),
      edited: m.is_edited,
      recalled: m.is_recalled_all,
      forwarded: !!m.forwarded_from_client_id,
      seenBy: (m.seen_by ?? []).map((s) => ({
        name: s.name || s.username,
        readAt: "",
      })),
      reactions: (m.reactions ?? []).map((r) => ({
        userId: r.user_id,
        emoji: r.emoji,
        name: r.mine ? "Bạn" : r.name,
        initials: r.initials,
        mine: r.mine,
      })),
      replyId: m.reply_to_client_id
        ? local.find(
            (x) =>
              x.clientId === m.reply_to_client_id ||
              (x.file?.fileId &&
                (m.reply_to_client_id === `file:${x.file.fileId}` ||
                  m.reply_to_client_id === x.file.fileId)),
          )?.id
        : undefined,
      replyToClientId: m.reply_to_client_id ?? undefined,
    }
  }

  const roomToConversation = (room: ApiRoom): Conversation => {
    const members: RoomMember[] = room.members.map((m) => ({
      id: m.id,
      name: m.display_name || m.username,
      initials: initialsOf(m.display_name || m.username),
      online: m.online,
      publicId: m.public_id,
      avatar: m.avatar || undefined,
      role: m.role,
    }))
    const isDirect = room.is_direct
    // Dùng id của CHÍNH MÌNH đã xác thực (meIdRef) — tránh lúc `/api/me` chưa trả về
    // (meId = 0) làm chọn nhầm thành viên → người đang hoạt động hiện "Ngoại tuyến".
    const selfId = meIdRef.current || meId
    const otherOnline = resolvePresence(members, selfId, !isDirect)
    const roomKey = String(room.id)
    let savedNicks: Record<number, string> | undefined
    try {
      const raw = localStorage.getItem(`room_nicks_${roomKey}`)
      if (raw) savedNicks = JSON.parse(raw)
    } catch {}
    const isPinned = localStorage.getItem(`room_pinned_${roomKey}`) === "true"
    const isMuted = localStorage.getItem(`room_muted_${roomKey}`) === "true"
    const savedApproval = localStorage.getItem(`room_approval_${roomKey}`) === "true"
    const savedName = localStorage.getItem(`room_name_${roomKey}`)
    const savedAvatar = localStorage.getItem(`room_avatar_${roomKey}`)
    const savedTheme = localStorage.getItem(`room_theme_${roomKey}`)
    const savedEmoji = localStorage.getItem(`room_emoji_${roomKey}`)
    if (room.background !== undefined) {
      if (room.background) {
        try { localStorage.setItem(`room_bg_${roomKey}`, room.background) } catch {}
      } else {
        try { localStorage.removeItem(`room_bg_${roomKey}`) } catch {}
      }
    }
    const savedBg = localStorage.getItem(`room_bg_${roomKey}`)

    const defaultName = room.name || members.map((m) => m.name).join(", ")
    const finalName = savedName || defaultName
    const finalAvatar = room.avatar || savedAvatar || undefined
    const finalTheme = savedTheme || room.theme_color || undefined
    const finalEmoji = room.default_reaction_emoji || savedEmoji || "👍"
    if (room.default_reaction_emoji) {
      try {
        localStorage.setItem(`room_emoji_${roomKey}`, room.default_reaction_emoji)
      } catch {}
    }
    const finalBg = room.background !== undefined ? (room.background || undefined) : (savedBg || undefined)

    return {
      id: ROOM_ID_OFFSET + room.id,
      realId: room.id,
      name: finalName,
      initials: initialsOf(finalName) || "#",
      online: otherOnline,
      lastMessage: "",
      time: formatClock(room.last_at),
      lastAt: room.last_at,
      messages: [],
      isGroup: !isDirect,
      createdBy: room.created_by,
      members,
      avatar: finalAvatar,
      theme: finalTheme,
      favEmoji: finalEmoji,
      bg: finalBg,
      pinned: isPinned,
      muted: isMuted,
      approval: savedApproval,
      nicknames: savedNicks,
    }
  }

  const mergeRooms = (rooms: ApiRoom[]) => {
    const convs = rooms.map(roomToConversation)
    setConversations((prev) => {
      const byRealId = new Map(
        convs.filter((c) => c.realId !== undefined).map((c) => [c.realId!, c]),
      )
      // Phòng đã có: cập nhật phần do SERVER quyết định (online/thành viên/tên/ảnh)
      // để trạng thái trực tuyến được đồng bộ lại mỗi lần nạp phòng — không cần reload.
      const updated = prev.map((c) => {
        const fresh = c.realId !== undefined ? byRealId.get(c.realId) : undefined
        if (!fresh) return c
        return {
          ...c,
          name: fresh.name || c.name,
          initials: fresh.initials || c.initials,
          online: fresh.online,
          members: fresh.members,
          isGroup: fresh.isGroup,
          avatar: fresh.avatar !== undefined ? fresh.avatar : c.avatar,
          createdBy: fresh.createdBy !== undefined ? fresh.createdBy : c.createdBy,
          theme: fresh.theme ?? c.theme,
          favEmoji: fresh.favEmoji ?? c.favEmoji,
          bg: fresh.bg !== undefined ? fresh.bg : c.bg,
          pinned: fresh.pinned !== undefined ? fresh.pinned : c.pinned,
          muted: fresh.muted !== undefined ? fresh.muted : c.muted,
          approval: fresh.approval !== undefined ? fresh.approval : c.approval,
          nicknames: fresh.nicknames ?? c.nicknames,
          lastAt: Math.max(c.lastAt ?? 0, fresh.lastAt ?? 0),
        }
      })
      const seen = new Set(prev.map((c) => c.realId).filter(Boolean))
      const fresh = convs.filter(
        (c) => c.realId !== undefined && !seen.has(c.realId),
      )
      if (fresh.length === 0) return updated
      return [...fresh, ...updated].sort(
        (a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0),
      )
    })
  }

  const refreshRooms = () =>
    api
      .roomsList()
      .then((r) => {
        if (r.ok && r.data) mergeRooms(r.data.rooms)
      })
      .catch(() => {})

  // Nạp lại danh sách bạn (chỉ gồm quan hệ đã accepted từ server).
  const refreshFriendList = () =>
    api.friendsList().then((r) => {
      if (!r.ok || !r.data) return
      setFriendList(
        r.data.friends
          .filter((f) => typeof f.id === "number")
          .map((f) => ({
            id: f.id as number,
            name: f.display_name,
            initials: initialsOf(f.display_name),
            online: f.online ?? false,
            publicId: f.public_id,
            avatar: f.avatar || undefined,
          })),
      )
    })

  useEffect(() => {
    void refreshRooms()
    if (!meId) return
    const timer = setInterval(() => {
      void refreshRooms()
    }, 20000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId])

  // Tải lịch sử thật khi mở phòng (chỉ phòng có realId). Tin optimistic đang
  // chờ/đã gửi được nhận diện qua clientId nên không bị nhân đôi khi history về.
  useEffect(() => {
    const conv = conversations.find((c) => c.id === selectedId)
    if (!conv || conv.realId === undefined) return
    let alive = true
    api.roomMessages(conv.realId, { limit: 30 }).then((r) => {
      if (!alive || !r.ok || !r.data) return
      const incoming = r.data.messages
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== conv.id) return c
          const incomingByCid = new Map(incoming.map((m) => [m.client_msg_id, m]))
          const updatedMessages = c.messages.map((m) => {
            if (!m.clientId) return m
            const apiMsg = incomingByCid.get(m.clientId)
            if (!apiMsg) return m
            const isRecalled = apiMsg.is_recalled_all
            return {
              ...m,
              recalled: isRecalled ? true : m.recalled,
              text: isRecalled ? "" : (m.text || apiMsg.content || ""),
              file: isRecalled ? undefined : m.file,
              edited: apiMsg.is_edited ? true : m.edited,
              reactions: (apiMsg.reactions ?? []).map((r) => ({
                userId: r.user_id,
                emoji: r.emoji,
                name: r.mine ? "Bạn" : r.name,
                initials: r.initials,
                mine: r.mine,
              })),
              seenBy: (apiMsg.seen_by ?? []).map((s) => ({
                name: s.name || s.username,
                readAt: "",
              })),
              replyToClientId: apiMsg.reply_to_client_id ?? m.replyToClientId,
            }
          })
          const have = new Set(c.messages.map((m) => m.clientId).filter(Boolean))
          const fresh = incoming
            .filter((m) => !have.has(m.client_msg_id))
            .map((m) => apiMessageToMessage(m, updatedMessages))
          const messages = [...updatedMessages, ...fresh].sort(
            (a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0),
          )
          const newest = fresh.reduce((mx, m) => Math.max(mx, m.sentAt ?? 0), 0)
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
          return {
            ...c,
            messages,
            lastMessage: lastMsgText,
            time: newest > 0 ? formatClock(newest) : c.time,
            lastAt: Math.max(c.lastAt ?? 0, newest),
          }
        }),
      )
      // Điền nội dung thật (đã giải mã cục bộ) cho các tin metadata content NULL.
      if (conv.realId !== undefined) {
        pullLocalHistory(conv.realId)
        const lastIncoming = incoming[incoming.length - 1]
        if (lastIncoming?.client_msg_id) {
          markRoomRead(conv.realId, lastIncoming.client_msg_id)
        }
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    void refreshFriendList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId])

  // Tải lời mời kết bạn thật mỗi khi mở dropdown (và khi đổi tài khoản).
  useEffect(() => {
    if (!friendReqOpen) return
    let alive = true
    api.friendRequests().then((r) => {
      if (!alive || !r.ok || !r.data) return
      setFriendRequests(
        r.data.requests.map((req) => ({
          id: req.request_id,
          name: req.from.display_name,
          initials: initialsOf(req.from.display_name),
          avatar: req.from.avatar,
          publicId: req.from.public_id,
        })),
      )
    })
    return () => {
      alive = false
    }
  }, [friendReqOpen, meId])

  const acceptRequest = async (id: number) => {
    const r = await api.acceptFriend(id)
    if (!r.ok) {
      pushToast("Không kết bạn được — thử lại sau")
      return
    }
    setFriendRequests((prev) => prev.filter((req) => req.id !== id))
    pushToast("Đã kết bạn")
    // LUỒNG 1c: dùng ngay phòng + bạn trong response để cập nhật tức thì (không đợi event).
    if (r.data?.room) mergeRooms([r.data.room])
    else refreshRooms()
    void refreshFriendList()
  }

  const rejectRequest = async (id: number) => {
    const r = await api.rejectFriend(id)
    if (!r.ok) {
      pushToast("Không từ chối được — thử lại sau")
      return
    }
    setFriendRequests((prev) => prev.filter((req) => req.id !== id))
  }

  // "Tham gia bằng mã": nhận mã phòng trần hoặc link /r/... rồi join thật.
  const joinByCode = async () => {
    const raw = joinCode.trim()
    if (!raw || joining) return
    const target = parseAnyLink(raw)
    const code =
      target?.type === "room"
        ? target.code
        : /^[0-9A-Za-z]{6,32}$/.test(raw)
          ? raw
          : null
    if (!code) {
      pushToast("Mã hoặc liên kết phòng không hợp lệ")
      return
    }
    setJoining(true)
    const r = await api.joinRoom(code)
    setJoining(false)
    if (!r.ok || !r.data) {
      pushToast(
        r.status === 404
          ? "Không tìm thấy phòng"
          : r.status === 410
            ? "Lời mời đã hết hạn"
            : r.status === 400
              ? "Phòng đã đầy"
              : "Không tham gia được — thử lại sau",
      )
      return
    }
    joinJoinedRoomApi(r.data.room)
    setJoinCode("")
    setFriendReqOpen(false)
    pushToast(r.data.already_member ? "Bạn đã ở trong phòng này" : "Đã tham gia phòng")
  }

  const createRoom = async ({
    name,
    avatar,
    members,
  }: {
    name: string
    avatar?: string
    members: RoomMember[]
  }) => {
    if (members.length === 0) return
    const r = await api.roomCreate({
      name: name.trim() || undefined,
      avatar,
      member_ids: members.map((m) => m.id),
    })
    if (!r.ok || !r.data) {
      pushToast(
        r.status === 401
          ? "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại."
          : `Không tạo được phòng${r.error ? ` (${r.error})` : ""}.`,
      )
      if (r.status === 401) onLogout()
      return
    }
    const room = roomToConversation(r.data.room)
    setConversations((prev) => [
      room,
      ...prev.filter((c) => c.realId !== room.realId),
    ])
    setSelectedId(room.id)
    setRoomInfoOpen(false)
    setShowCreateRoom(false)
  }

  const joinRoomFromLink = ({
    name,
    initials,
    memberCount,
  }: {
    name: string
    initials: string
    memberCount: number
  }) => {
    const existing = conversations.find((c) => c.isGroup && c.name === name)
    if (existing) {
      setSelectedId(existing.id)
      return
    }
    const id = Date.now()
    const members: RoomMember[] = Array.from(
      { length: memberCount },
      (_, i) => ({
        id: i + 1,
        name: `Thành viên ${i + 1}`,
        initials: `T${i + 1}`,
        online: i % 2 === 0,
      }),
    )
    const room: Conversation = {
      id,
      name,
      initials,
      online: false,
      lastMessage: "Bạn đã tham gia phòng",
      time: nowTime(),
      lastAt: Date.now(),
      messages: [],
      isGroup: true,
      members,
    }
    setConversations((prev) => [room, ...prev])
    setSelectedId(id)
    setRoomInfoOpen(false)
  }

  const joinJoinedRoomApi = (room: ApiRoom) => {
    const conv = roomToConversation(room)
    setConversations((prev) => [
      conv,
      ...prev.filter((c) => c.realId !== conv.realId),
    ])
    setSelectedId(conv.id)
    setRoomInfoOpen(false)
    setShowFindFriends(false)
    setFindSeed(null)
    onInviteConsumed?.()
  }

  return {
    friendList,
    setFriendList,
    friendRequests,
    setFriendRequests,
    friendReqOpen,
    setFriendReqOpen,
    inviteTab,
    setInviteTab,
    joinCode,
    setJoinCode,
    joining,
    apiMessageToMessage,
    roomToConversation,
    mergeRooms,
    refreshRooms,
    refreshFriendList,
    acceptRequest,
    rejectRequest,
    joinByCode,
    createRoom,
    joinRoomFromLink,
    joinJoinedRoomApi,
  }
}
