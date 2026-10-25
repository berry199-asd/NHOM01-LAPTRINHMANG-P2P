import { useState, useRef, useEffect } from "react"
import { type ProfileData } from "../components/ProfilePanel"
import { useCallManager } from "../features/call/useCallManager"
import { CallOverlayContainer } from "../features/call/CallOverlayContainer"
import { FriendsPage } from "../features/friends/FriendsPage"
import { FriendRequestsDropdown } from "../features/friends/FriendRequestsDropdown"
import { UserMenuDropdown } from "../features/profile/UserMenuDropdown"
import { ConversationSidebar } from "../features/conversations/ConversationSidebar"
import { ProfileModals } from "../features/profile/ProfileModals"
import { E2eChangePassModal } from "../components/E2eChangePassModal"
import { NetworkPeerStatus } from "../features/connection/NetworkPeerStatus"
import { useRoomManagement } from "../features/rooms/useRoomManagement"
import { ChatHeader } from "../features/chat/ChatHeader"
import { MessageList } from "../features/chat/MessageList"
import { MessageInput } from "../features/chat/MessageInput"
import { useChatSearch } from "../features/chat/useChatSearch"
import { useLightbox } from "../features/chat/useLightbox"
import { useVoiceRecorder } from "../features/chat/useVoiceRecorder"
import { usePeerConnection } from "../features/connection/usePeerConnection"
import { useChatMessages } from "../features/chat/useChatMessages"
import {
  type Conversation,
  EMPTY_CONVERSATION,
} from "../types/chat"
import { CreateRoomModal } from "../components/CreateRoomModal"
import { BlockSharedModal } from "../features/chat/modals/BlockSharedModal"
import { MediaPreviewModal } from "../features/chat/modals/MediaPreviewModal"
import { MediaLightboxModal } from "../features/chat/modals/MediaLightboxModal"
import { ShareMessageModal } from "../features/chat/modals/ShareMessageModal"
import { ReactionViewModal } from "../features/chat/modals/ReactionViewModal"
import { RouteMismatchModal } from "../features/chat/modals/RouteMismatchModal"
import { InfoPanel } from "../features/info/ChatInfoPanel"
import { SeenByModal } from "../features/chat/bubbles/SeenByModal"
import { initialsOf } from "../features/chat/bubbles/VoiceBubble"
import { themeIcon } from "../features/chat/emojiData"
import {
  putPeople,
} from "../lib/personDirectory"
import {
  api,
  type ApiRoom,
  type Relation,
} from "../lib/api"
import {
  type PeerUiFrame,
  type PeerOfflineMsg,
} from "../lib/peer"
import {
  parseRoute,
  buildAccountPath,
  buildRoomPath,
  buildFriendsPath,
  type FriendsTab,
  stashPendingPath,
  type InviteTarget,
} from "../lib/link"
import { type StatusPatch } from "../lib/pendingStatus"

interface Props {
  darkMode: boolean
  onToggleDark: () => void
  onLogout: () => void
  inviteTarget?: InviteTarget | null
  onInviteConsumed?: () => void
}

const ROLE_LABELS: Record<string, string> = {
  user: "Người dùng",
  moderator: "Kiểm duyệt viên",
  admin: "Quản trị viên",
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

function fmtBirthdate(iso?: string): string {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return "—"
  return `${d}/${m}/${y}`
}

function fmtJoined(iso?: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const months = [
    "Tháng 1",
    "Tháng 2",
    "Tháng 3",
    "Tháng 4",
    "Tháng 5",
    "Tháng 6",
    "Tháng 7",
    "Tháng 8",
    "Tháng 9",
    "Tháng 10",
    "Tháng 11",
    "Tháng 12",
  ]
  return `${months[date.getMonth()]}, ${date.getFullYear()}`
}

export function Home({ darkMode, onToggleDark, onLogout, inviteTarget, onInviteConsumed }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState(1)
  const [search, setSearch] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [showChangePass, setShowChangePass] = useState(false)
  const [showE2eChangePass, setShowE2eChangePass] = useState(false)
  const [showChangeEmail, setShowChangeEmail] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [phonePublic, setPhonePublic] = useState(true)
  const [meId, setMeId] = useState(0)
  const meIdRef = useRef(0)
  const [meUsername, setMeUsername] = useState<string | null>(null)
  const [mePublicId, setMePublicId] = useState<string | null>(null)
  const [routeMismatch, setRouteMismatch] = useState<string | null>(null)
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])

  const [friendsTab, setFriendsTab] = useState<FriendsTab | null>(() => {
    if (typeof window === "undefined") return null
    const r = parseRoute(window.location.pathname)
    return r.kind === "friends" ? r.tab : null
  })

  const openFriendsPage = (tab: FriendsTab = "requests") => {
    setFriendsTab(tab)
    window.history.pushState(null, "", buildFriendsPath(tab))
  }

  const handleFriendsChangeTab = (nextTab: FriendsTab) => {
    setFriendsTab(nextTab)
    window.history.replaceState(null, "", buildFriendsPath(nextTab))
  }

  const closeFriendsPage = () => {
    setFriendsTab(null)
    const acc = mePublicId || meUsername
    const currentRoom = conversations.find((c) => c.id === selectedId)
    if (acc && currentRoom?.realId) {
      window.history.pushState(null, "", buildRoomPath(acc, currentRoom.realId))
    } else if (acc) {
      window.history.pushState(null, "", buildAccountPath(acc))
    } else {
      window.history.pushState(null, "", "/")
    }
  }

  const pushToast = (text: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, text }])
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      6000,
    )
  }

  const [viewProfile, setViewProfile] = useState<ProfileData | null>(null)
  const [viewCtx, setViewCtx] = useState<{
    isBlocked: boolean
    isFriend: boolean
    phoneVisible: boolean
    publicId?: string
    online?: boolean
    relation?: Relation
    requestId?: number
  }>({ isBlocked: false, isFriend: false, phoneVisible: false })

  const [blockShared, setBlockShared] = useState<{
    name: string
    groups: { id: number; name: string }[]
  } | null>(null)

  const [blockedList, setBlockedList] = useState<{
    id: number
    name: string
    initials: string
  }[]>(() => {
    try {
      const raw = localStorage.getItem("blocked_users")
      if (raw) return JSON.parse(raw)
    } catch {}
    return []
  })

  useEffect(() => {
    if (blockedList.length === 0) return
    const blockedNames = new Set(blockedList.map((b) => b.name))
    setConversations((prev) =>
      prev.map((c) =>
        !c.isGroup && blockedNames.has(c.name) && !c.blocked
          ? { ...c, blocked: true }
          : c,
      ),
    )
  }, [blockedList])

  const [profile, setProfile] = useState<ProfileData>({
    name: "Trần Minh",
    initials: "TM",
    status: "Đang tập trung cho dự án Q4",
    email: "tranminh@workchat.vn",
    phone: "0901 234 567",
    role: "Người dùng",
    joinDate: "15/03/2023",
    birthdate: "12/08/2002",
  })

  const [showFindFriends, setShowFindFriends] = useState(false)
  const [findSeed, setFindSeed] = useState<InviteTarget | null>(null)
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [roomInfoOpen, setRoomInfoOpen] = useState(false)
  const [adminIds, setAdminIds] = useState<Record<number, number[]>>({})
  const [showJump, setShowJump] = useState(false)

  // Element Refs
  const chatEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const friendReqRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageInputRef = useRef<HTMLInputElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const emojiPanelRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const atBottomRef = useRef(true)
  const lastReadRef = useRef(new Map<number, string>())
  const selectedRoomIdRef = useRef<number | undefined>(undefined)
  const lastTypingSentRef = useRef(0)
  const pendingStatusRef = useRef<Map<string, StatusPatch>>(new Map())
  const conversationsRef = useRef(conversations)
  const urlInitRef = useRef(false)
  const seenPeerIds = useRef(new Set<string>())
  const pendingOfflineRef = useRef<PeerOfflineMsg[]>([])
  const onCallFrameRef = useRef<(f: PeerUiFrame) => void>(() => {})
  const onCallErrorRef = useRef<(code: string | undefined, detail?: string) => void>(() => {})

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const selected =
    conversations.find((c) => c.id === selectedId) ??
    conversations[0] ??
    EMPTY_CONVERSATION

  useEffect(() => {
    selectedRoomIdRef.current = selected.realId
  }, [selected.realId])

  const {
    friendList,
    friendRequests,
    friendReqOpen,
    setFriendReqOpen,
    inviteTab,
    setInviteTab,
    joinCode,
    setJoinCode,
    joining,
    roomToConversation,
    mergeRooms,
    refreshRooms,
    refreshFriendList,
    acceptRequest,
    rejectRequest,
    joinByCode,
    joinJoinedRoomApi,
    createRoom,
  } = useRoomManagement({
    meId,
    meIdRef,
    conversations,
    setConversations,
    selectedId,
    setSelectedId,
    conversationsRef,
    pullLocalHistory: (rid, before) => chatMessages.pullLocalHistory(rid, before),
    markRoomRead: (rid, cid) => chatMessages.markRoomRead(rid, cid),
    pushToast,
    onLogout,
    setRoomInfoOpen,
    setShowCreateRoom,
    setShowFindFriends,
    setFindSeed,
    onInviteConsumed,
  })

  const {
    recState,
    recSeconds,
    recUrl,
    recDuration,
    startRecording,
    stopRecording,
    cancelPreview,
    clearRecordedVoice,
  } = useVoiceRecorder({
    pushToast,
    onSendVoice: (url, dur) => chatMessages.sendVoice(url, dur),
  })

  const peerConnection = usePeerConnection({
    meId,
    meIdRef,
    pushToast,
    onSessionEnded: () => onLogout(),
    afterPeerReady: () => {
      void refreshRooms()
      const rid = selectedRoomIdRef.current
      if (rid) {
        chatMessages.pullLocalHistory(rid, undefined, 30)
      }
      chatMessages.reDecryptPendingMessages(rid)
    },
    onDecryptBatch: (items) => chatMessages.handleDecryptBatch(items),
    onCallFrame: (f) => onCallFrameRef.current(f),
    onCallError: (code, detail) => onCallErrorRef.current(code, detail),
    onChat: (chat) => chatMessages.handlePeerChat(chat),
    onHistory: (rid, msgs, hasMore) => chatMessages.handlePeerHistory(rid, msgs, hasMore),
    onFile: (f) => chatMessages.handlePeerFile(f),
    onFileState: (f) => chatMessages.handlePeerFileState(f),
    onSeen: (rid, mid, fromUid) => chatMessages.handlePeerSeen(rid, mid, fromUid),
    onTyping: (rid, username, uid) => chatMessages.handlePeerTyping(rid, username, uid),
    onEdit: (rid, cid, text) => chatMessages.handlePeerEdit(rid, cid, text),
    onRecall: (rid, cid) => chatMessages.handlePeerRecall(rid, cid),
    onReaction: (rid, cid, emoji, remove, username) =>
      chatMessages.handlePeerReaction(rid, cid, emoji, remove, username),
    onPresence: (uid, online) => chatMessages.handlePeerPresence(uid, online),
    onSendState: (rid, cid, state, retryable) => {
      chatMessages.applySendState(rid, cid, {
        status: state === "failed" ? "failed" : state === "sent" ? "sent" : state === "stored" ? "stored" : "sending",
        retryable,
      })
    },
    onDecryptFailed: (rid, cid) => {
      chatMessages.patchRoomMsg(rid, cid, (m) => ({
        ...m,
        decrypted: true,
        undecryptable: true,
      }))
    },
    onFriendAccepted: (room, friend) => {
      if (room) mergeRooms([room])
      else void refreshRooms()
      void refreshFriendList()
      const fname = friend?.display_name
      pushToast(fname ? `Đã kết bạn với ${fname}` : "Đã kết bạn")
    },
    onRoomAdded: (room) => {
      if (room) mergeRooms([room])
      else void refreshRooms()
      pushToast(`Bạn đã được thêm vào phòng "${room?.name || "mới"}"`)
    },
    onRoomUpdated: (room) => {
      if (room) mergeRooms([room])
    },
    onRoomRemoved: (roomId) => {
      setConversations((prev) => prev.filter((c) => c.realId !== roomId))
    },
    onOfflineMessage: (msg) => chatMessages.handlePeerOffline(msg),
  })

  const {
    peerPort,
    peerState,
    otherPeer,
    noFreeCore,
    peerTransport,
    e2eState,
    setE2eState,
    serverRealtime,
    serverReason,
    browserOnline,
    netState,
    peerRef,
    peerOnRef,
    passphraseRef,
    peerApiPortRef,
    peerStatusLabel,
    applyStun,
    handleReleasePeer,
    requestUnlock,
    requestChangePassphrase,
    requestResetKeystore,
    logoutWithPeerRevoke,
  } = peerConnection

  const chatMessages = useChatMessages({
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
  })

  const {
    messageInput,
    setMessageInput,
    replyToId,
    jumpId,
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
    dragOver,
    mediaPreview,
    setMediaPreview,
    previewPlayUrl,
    setPreviewPlayUrl,
    editingId,
    shareMsg,
    setShareMsg,
    shareTargets,
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
    sendMessage,
    retryOutgoing,
    sendLike,
    sendVoice,
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
    confirmSendMedia,
  } = chatMessages

  const callManager = useCallManager({
    meId,
    meIdRef,
    profile,
    meUsername,
    conversations,
    setConversations,
    pushToast,
    peerRef,
    onCallFrameRef,
    onCallErrorRef,
  })
  const {
    call,
    callBusy,
    callDur,
    startCall,
  } = callManager

  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    searchIdx,
    searchCurId,
    setSearchQuery,
    setSearchIdx,
    setSearchCurId,
    computeSearch,
    focusSearchResult,
    jumpToSearch,
    openSearch,
    closeSearch,
    highlightBody,
  } = useChatSearch(selected)

  const {
    lightbox,
    setLightbox,
    thumbStripRef,
    openLightbox,
    stepLightbox,
  } = useLightbox(selected)

  const visibleMessages = selected.messages.filter(
    (m) => m.decrypted !== false || m.undecryptable,
  )

  useEffect(() => {
    if (
      conversations.length > 0 &&
      !conversations.some((c) => c.id === selectedId)
    ) {
      setSelectedId(conversations[0].id)
    }
  }, [conversations, selectedId])

  useEffect(() => {
    atBottomRef.current = true
    setShowJump(false)
    setActiveActionsId(null)
    cancelReply()
    setSearchOpen(false)
    setSearchQuery("")
    setSearchIdx(0)
    setSearchCurId(null)
    clearRecordedVoice()
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [selectedId])

  useEffect(() => {
    putPeople([
      {
        id: meId,
        name: profile.name,
        username: meUsername ?? undefined,
        avatar: profile.avatar,
      },
      ...friendList.map((f) => ({
        id: f.id,
        name: f.name,
        username: f.username,
        publicId: f.publicId,
        avatar: f.avatar,
      })),
      ...conversations.flatMap((c) => {
        const list: Array<{
          id: number
          name?: string
          username?: string
          publicId?: string
          avatar?: string
        }> = (c.members ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          publicId: m.publicId,
          avatar: m.avatar,
        }))
        const other = (c.members ?? []).find((m) => m.id !== meId)
        if (other && c.avatar) {
          list.push({
            id: other.id,
            name: other.name || c.name,
            publicId: other.publicId,
            avatar: c.avatar,
          })
        }
        return list
      }),
    ])
  }, [meId, meUsername, profile.name, profile.avatar, friendList, conversations])

  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (
        emojiPanelRef.current &&
        !emojiPanelRef.current.contains(t) &&
        emojiBtnRef.current &&
        !emojiBtnRef.current.contains(t)
      ) {
        setEmojiOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmojiOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("touchstart", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("touchstart", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [emojiOpen])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    } else {
      setShowJump(true)
    }
  }, [selected?.messages.length])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setOptionsOpen(false)
      }
      if (
        friendReqRef.current &&
        !friendReqRef.current.contains(e.target as Node)
      ) {
        setFriendReqOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    if (inviteTarget) {
      setFindSeed(inviteTarget)
      setShowFindFriends(true)
    }
  }, [inviteTarget])

  const openRoomRoute = (accountId: string, roomId: number) => {
    const existing = conversationsRef.current.find((c) => c.realId === roomId)
    if (existing) {
      setSelectedId(existing.id)
      return
    }
    api.roomDetail(roomId).then((res) => {
      const conv =
        res.ok && res.data?.room ? roomToConversation(res.data.room) : null
      if (conv) {
        setConversations((prev) => [
          conv,
          ...prev.filter((c) => c.realId !== conv.realId),
        ])
        setSelectedId(conv.id)
      } else {
        pushToast(
          "Không mở được phòng: bạn không phải thành viên hoặc phòng không tồn tại.",
        )
        window.history.replaceState(null, "", buildAccountPath(accountId))
      }
    })
  }

  const handleInitialRoute = (publicId: string | null, username: string) => {
    const route = parseRoute(window.location.pathname)
    if (route.kind === "friends") {
      setFriendsTab(route.tab)
      return
    }
    const matches = (seg: string) =>
      (!!publicId && seg === publicId) ||
      (!!username && seg.toLowerCase() === username.toLowerCase())
    if (route.kind === "room") {
      if (!matches(route.accountId)) {
        setRouteMismatch(route.accountId)
        return
      }
      openRoomRoute(publicId || route.accountId, route.roomId)
      return
    }
    if (route.kind === "account") {
      if (!matches(route.accountId)) {
        setRouteMismatch(route.accountId)
      }
    }
  }

  useEffect(() => {
    api.me().then((r) => {
      if (r.ok && r.data?.user) {
        const u = r.data.user
        meIdRef.current = u.id
        setMeId(u.id)
        setMeUsername(u.username)
        setMePublicId(u.public_id || null)
        handleInitialRoute(u.public_id || null, u.username)
        setProfile({
          name: u.display_name || u.username,
          initials: makeInitials(u.display_name || u.username, u.email),
          status: u.bio ?? "",
          email: u.email,
          phone: u.phone ?? "",
          role: (ROLE_LABELS[u.role] as ProfileData["role"]) ?? "Người dùng",
          joinDate: fmtJoined(u.joined),
          birthdate: fmtBirthdate(u.birthdate),
          birthdateISO: u.birthdate || undefined,
          cover: u.cover || undefined,
          avatar: u.avatar || undefined,
        })
        setPhonePublic(u.phone_public ?? true)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const accountId = mePublicId || meUsername
    if (!accountId || routeMismatch || friendsTab) return
    const hasRoom = selected.realId !== undefined
    const desired = hasRoom
      ? buildRoomPath(accountId, selected.realId as number)
      : buildAccountPath(accountId)
    if (window.location.pathname === desired) {
      if (hasRoom) urlInitRef.current = true
      return
    }
    if (!urlInitRef.current) {
      window.history.replaceState(null, "", desired)
      if (hasRoom) urlInitRef.current = true
    } else {
      window.history.pushState(null, "", desired)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meUsername, mePublicId, selected.realId, routeMismatch, friendsTab])

  useEffect(() => {
    const base = meUsername ? `WorkChat — ${meUsername}` : "WorkChat"
    document.title =
      selected.realId !== undefined ? `${base} · ${selected.name}` : base
  }, [meUsername, selected.realId, selected.name])

  useEffect(() => {
    const onPop = () => {
      const route = parseRoute(window.location.pathname)
      if (route.kind === "friends") {
        setFriendsTab(route.tab)
        return
      }
      setFriendsTab(null)
      if (!meUsername && !mePublicId) return
      if (route.kind === "room") {
        const seg = route.accountId
        const mine =
          (!!mePublicId && seg === mePublicId) ||
          (!!meUsername && seg.toLowerCase() === meUsername.toLowerCase())
        if (mine) {
          openRoomRoute(mePublicId || meUsername!, route.roomId)
        }
      }
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meUsername, mePublicId])

  const handleSaveProfile = (p: ProfileData) => {
    setProfile(p)
    api
      .updateProfile({
        display_name: p.name,
        bio: p.status,
        phone: p.phone,
        date_of_birth: p.birthdateISO || undefined,
        phone_public: phonePublic,
        avatar: p.avatar || undefined,
        cover: p.cover || "",
      })
      .then((r) => {
        if (!r.ok && r.status === 401) {
          pushToast("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại.")
          onLogout()
        } else if (!r.ok) {
          pushToast("Không lưu được hồ sơ, vui lòng thử lại.")
        } else if (r.ok && r.data?.user) {
          setProfile((prev) => ({ ...prev, email: r.data!.user!.email }))
        }
      })
  }

  const handleEmailUpdated = (newEmail: string) => {
    setProfile((prev) => ({ ...prev, email: newEmail }))
  }

  const handleMismatchSwitch = () => {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/@")) {
      stashPendingPath(window.location.pathname)
    }
    setRouteMismatch(null)
    logoutWithPeerRevoke(onLogout)
  }

  const handleMismatchLogout = () => {
    setRouteMismatch(null)
    logoutWithPeerRevoke(onLogout)
  }

  const patchConversation = (patch: Partial<Conversation>) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)),
    )
    const target = conversations.find((c) => c.id === selectedId) ?? selected
    const roomKey = target.realId !== undefined ? String(target.realId) : String(selectedId)

    try {
      if (patch.pinned !== undefined) {
        localStorage.setItem(`room_pinned_${roomKey}`, String(patch.pinned))
      }
      if (patch.muted !== undefined) {
        localStorage.setItem(`room_muted_${roomKey}`, String(patch.muted))
      }
      if (patch.approval !== undefined) {
        localStorage.setItem(`room_approval_${roomKey}`, String(patch.approval))
      }
      if (patch.nicknames !== undefined) {
        localStorage.setItem(`room_nicks_${roomKey}`, JSON.stringify(patch.nicknames))
      }
      if (patch.theme !== undefined) {
        localStorage.setItem(`room_theme_${roomKey}`, patch.theme)
      }
      if (patch.favEmoji !== undefined) {
        localStorage.setItem(`room_emoji_${roomKey}`, patch.favEmoji)
      }
      if ("bg" in patch) {
        if (patch.bg) localStorage.setItem(`room_bg_${roomKey}`, patch.bg)
        else localStorage.removeItem(`room_bg_${roomKey}`)
      }
      if ("avatar" in patch) {
        if (patch.avatar) localStorage.setItem(`room_avatar_${roomKey}`, patch.avatar)
        else localStorage.removeItem(`room_avatar_${roomKey}`)
      }
      if (patch.name !== undefined) {
        localStorage.setItem(`room_name_${roomKey}`, patch.name)
      }
    } catch (e) {
      console.warn("Lưu thiết lập đoạn chat vào localStorage thất bại:", e)
    }

    const rid = target.realId
    if (rid !== undefined) {
      void api
        .roomUpdate(rid, {
          name: patch.name,
          avatar: "avatar" in patch ? (patch.avatar ?? "") : undefined,
          theme: patch.theme,
          emoji: patch.favEmoji ?? (patch as any).emoji,
          bg: "bg" in patch ? (patch.bg ?? "") : undefined,
        })
        .then((r) => {
          if (r.ok && r.data?.room) {
            mergeRooms([r.data.room])
          }
        })
    }
  }

  const getAdmins = () => {
    const serverAdmins = (selected.members ?? [])
      .filter(
        (m) =>
          m.role?.toLowerCase() === "leader" ||
          m.role?.toLowerCase() === "admin" ||
          m.role?.toLowerCase() === "creator" ||
          m.role?.toLowerCase() === "owner" ||
          (selected.createdBy !== undefined && m.id === selected.createdBy)
      )
      .map((m) => m.id)
    if (serverAdmins.length > 0) return serverAdmins

    const roomKey = selected.realId !== undefined ? String(selected.realId) : String(selectedId)
    if (adminIds[selectedId] && adminIds[selectedId].length > 0) {
      return adminIds[selectedId]
    }
    try {
      const raw = localStorage.getItem(`room_admins_${roomKey}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}

    if (selected.createdBy) return [selected.createdBy]
    return [selected.members?.[0]?.id].filter((x): x is number => typeof x === "number")
  }

  const toggleAdmin = async (memberId: number) => {
    const cur = new Set(getAdmins())
    const willBeAdmin = !cur.has(memberId)
    const nextAdmins = willBeAdmin ? [memberId] : []
    setAdminIds((prev) => ({ ...prev, [selectedId]: nextAdmins }))
    const roomKey = selected.realId !== undefined ? String(selected.realId) : String(selectedId)
    try {
      localStorage.setItem(`room_admins_${roomKey}`, JSON.stringify(nextAdmins))
    } catch {}

    const rid = selected.realId
    if (rid !== undefined) {
      const res = await api.roomMemberRole(rid, memberId, willBeAdmin ? "leader" : "member")
      if (res.ok && res.data?.room) {
        mergeRooms([res.data.room])
      } else if (!res.ok) {
        pushToast(res.error || "Không thể cập nhật vai trò trên máy chủ")
      }
    }
    pushToast(willBeAdmin ? "Đã chuyển quyền trưởng nhóm" : "Đã gỡ quyền trưởng nhóm")
  }

  const removeMemberAndClean = async (memberId: number) => {
    const next = (selected.members ?? []).filter((m) => m.id !== memberId)
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, members: next } : c)),
    )
    setAdminIds((prev) => {
      const cur = prev[selectedId] ?? []
      return { ...prev, [selectedId]: cur.filter((x) => x !== memberId) }
    })
    const rid = selected.realId
    if (rid !== undefined) {
      const res = await api.roomMemberRemove(rid, memberId)
      if (!res.ok) {
        pushToast(res.error || "Không thể xoá khỏi nhóm trên máy chủ")
        return
      }
    }
    pushToast("Đã xoá khỏi nhóm")
  }

  const leaveRoom = () => {
    const rid = selected.realId
    if (rid !== undefined) {
      void api.roomLeave(rid)
    }
    setConversations((prev) => prev.filter((c) => c.id !== selectedId))
    setRoomInfoOpen(false)
    const rest = conversations.filter((c) => c.id !== selectedId)
    if (rest.length > 0) setSelectedId(rest[0].id)
    pushToast("Đã rời khỏi nhóm")
  }

  const deleteChat = () => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, messages: [], lastMessage: "", blocked: undefined }
          : c,
      ),
    )
    setRoomInfoOpen(false)
    pushToast("Đã xoá đoạn chat")
  }

  const addBlocked = (
    name: string,
    initials: string,
    opts?: { id?: number; convId?: number },
  ) => {
    const id = opts?.id ?? opts?.convId ?? -Date.now()
    setBlockedList((prev) => {
      const next = prev.some((b) => b.name === name)
        ? prev
        : [...prev, { id, name, initials }]
      try {
        localStorage.setItem("blocked_users", JSON.stringify(next))
      } catch {}
      return next
    })
    setConversations((prev) =>
      prev.map((c) =>
        !c.isGroup && c.name === name ? { ...c, blocked: true } : c,
      ),
    )
    const shared = conversations.filter(
      (c) => c.isGroup && (c.members ?? []).some((m) => m.name === name),
    )
    if (shared.length > 0) {
      setBlockShared({
        name,
        groups: shared.map((g) => ({ id: g.id, name: g.name })),
      })
    } else {
      pushToast(`Đã chặn ${name}`)
    }
  }

  const unblockById = (id: number, name: string) => {
    setBlockedList((prev) => {
      const next = prev.filter((b) => b.name !== name)
      try {
        localStorage.setItem("blocked_users", JSON.stringify(next))
      } catch {}
      return next
    })
    setConversations((prev) =>
      prev.map((c) =>
        !c.isGroup && c.name === name ? { ...c, blocked: false } : c,
      ),
    )
    pushToast(`Đã bỏ chặn ${name}`)
  }

  const blockUser = () => {
    addBlocked(selected.name, selected.initials, {
      id: selected.id,
      convId: selected.id,
    })
    setRoomInfoOpen(false)
  }

  const unblockUser = () => {
    unblockById(selected.id, selected.name)
  }

  const stayInSharedGroups = () => {
    if (blockShared)
      pushToast(`Bạn vẫn ở lại nhóm chung với ${blockShared.name}`)
    setBlockShared(null)
  }

  const leaveSharedGroups = () => {
    const ids = new Set((blockShared?.groups ?? []).map((g) => g.id))
    const rest = conversations.filter((c) => !ids.has(c.id))
    setConversations(rest)
    if (ids.has(selectedId) && rest.length > 0) setSelectedId(rest[0].id)
    setBlockShared(null)
    pushToast("Đã rời khỏi các nhóm chung")
  }

  const openOtherProfile = (base: {
    name: string
    initials: string
    avatar?: string
    status?: string
    isFriend?: boolean
    publicId?: string
    online?: boolean
    relation?: Relation
    requestId?: number
  }) => {
    const isFriend =
      base.isFriend ??
      conversations.some((c) => !c.isGroup && c.name === base.name)
    setViewProfile({
      name: base.name,
      initials: base.initials,
      avatar: base.avatar,
      status: base.status ?? "",
      email: "",
      phone: "",
      role: "Người dùng",
      joinDate: "",
      birthdate: "",
    })
    setViewCtx({
      isBlocked: blockedList.some((b) => b.name === base.name),
      isFriend,
      phoneVisible: false,
      publicId: base.publicId,
      online: base.online,
      relation: base.relation,
      requestId: base.requestId,
    })
  }

  const openChatWith = async (
    name: string,
    initials: string,
    publicId?: string,
  ) => {
    const existing = conversations.find((c) => !c.isGroup && c.name === name)
    if (existing) {
      setSelectedId(existing.id)
      setViewProfile(null)
      return
    }
    const friend = friendList.find(
      (f) => (publicId && f.publicId === publicId) || f.name === name,
    )
    if (friend && typeof friend.id === "number") {
      const r = await api.openDirectRoom(friend.id)
      if (r.ok && r.data) {
        const conv = roomToConversation(r.data.room)
        setConversations((prev) => [
          conv,
          ...prev.filter((c) => c.realId !== conv.realId),
        ])
        setSelectedId(conv.id)
        setViewProfile(null)
        return
      }
    }
    const newId = Math.max(0, ...conversations.map((c) => c.id)) + 1
    const conv: Conversation = {
      id: newId,
      name,
      initials,
      online: true,
      lastMessage: "",
      time: "",
      lastAt: Date.now(),
      messages: [],
      isGroup: false,
      members: [],
    }
    setConversations((prev) => [...prev, conv])
    setSelectedId(newId)
    setViewProfile(null)
  }

  const viewBlock = () => {
    if (!viewProfile) return
    addBlocked(viewProfile.name, viewProfile.initials)
    setViewCtx((c) => ({ ...c, isBlocked: true }))
  }

  const viewUnblock = () => {
    if (!viewProfile) return
    unblockById(-1, viewProfile.name)
    setViewCtx((c) => ({ ...c, isBlocked: false }))
  }

  const togglePhonePublic = () => {
    const nv = !phonePublic
    setPhonePublic(nv)
    pushToast(
      nv
        ? "Mọi người có thể xem số điện thoại của bạn"
        : "Đã ẩn số điện thoại của bạn",
    )
    api.updateProfile({ phone_public: nv }).catch(() => {})
  }

  const reportConversation = () => {
    pushToast(`Đã gửi báo cáo về ${selected.name}`)
  }

  const peerNotice =
    selected.realId === undefined
      ? null
      : peerState !== "on"
        ? "Peer Core chưa kết nối — tin nhắn đã mã hoá sẽ hiển thị khi kết nối lại"
        : e2eState !== "unlocked"
          ? "Chưa mở khoá mã hoá đầu-cuối — tin đã nhận sẽ hiển thị sau khi mở khoá"
          : null

  const net = netState.quality

  const serverReasonText = (() => {
    const r = serverReason
    if (!r) return ""
    const parts: string[] = []
    if (r.tracker) parts.push(`Tracker ${r.tracker}`)
    if (r.ws) parts.push(`kênh WS: ${r.ws}`)
    if (typeof r.attempts === "number" && r.attempts > 0) parts.push(`đã nối lại ${r.attempts} lần`)
    if (r.lastError) {
      const at = r.lastErrorAt ? new Date(r.lastErrorAt).toLocaleTimeString() : ""
      parts.push(`lỗi cuối: ${r.lastError}${at ? ` (${at})` : ""}`)
    }
    if (r.lastPong) parts.push(`pong cuối: ${new Date(r.lastPong).toLocaleTimeString()}`)
    if (r.http) parts.push(`HTTP cuối: ${new Date(r.http).toLocaleTimeString()}`)
    return parts.join(" · ")
  })()

  const probeReasonText = !browserOnline
    ? "Trình duyệt báo mất mạng"
    : peerState !== "on"
      ? "Chưa kết nối Peer Core"
      : "Không nhận phản hồi (pong) từ Peer Core"

  const netBannerTitle =
    [probeReasonText, serverReasonText].filter(Boolean).join(" — ") ||
    "Peer Core chưa thấy Tracker phản hồi"

  return (
    <div
      className="flex flex-col h-screen"
      style={{ backgroundColor: "var(--bg)" }}
    >
      <NetworkPeerStatus
        peerState={peerState}
        noFreeCore={noFreeCore}
        otherPeer={otherPeer}
        net={net}
        serverRealtime={serverRealtime}
        netBannerTitle={netBannerTitle}
        probeReasonText={probeReasonText}
        serverReasonText={serverReasonText}
        peerPort={peerPort}
        peerStatusLabel={peerStatusLabel}
        e2eState={e2eState}
        onReleasePeer={handleReleasePeer}
        onApplyStun={applyStun}
        onToggleE2e={() => {
          if (e2eState === "unlocked") {
            peerRef.current?.send({ type: "lock" })
            passphraseRef.current = null
            setE2eState("locked")
            pushToast("Đã khoá mã hoá đầu-cuối E2E")
          } else {
            requestUnlock()
          }
        }}
        onRequestChangePassphrase={requestChangePassphrase}
        onRequestResetKeystore={requestResetKeystore}
      />

      {/* Topbar */}
      <header
        className="flex items-center justify-between px-4 h-14 flex-shrink-0"
        style={{
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--bg)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-fg)",
            }}
          >
            W
          </div>
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: "var(--text)" }}
          >
            WorkChat
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (friendsTab) {
                closeFriendsPage()
              } else {
                openFriendsPage(
                  friendRequests.length > 0 ? "requests" : "suggestions",
                )
              }
              setMenuOpen(false)
            }}
            title="Bạn bè"
            aria-label={`Bạn bè${friendRequests.length > 0 ? `, có ${friendRequests.length} lời mời mới` : ""}`}
            className="p-2 rounded-md transition-opacity hover:opacity-60 relative"
            style={{
              color: friendsTab ? "var(--primary)" : "var(--muted)",
              backgroundColor: friendsTab ? "var(--surface)" : "transparent",
            }}
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
              aria-hidden="true"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            {friendRequests.length > 0 && (
              <span
                className="absolute top-1 right-1 w-4 h-4 rounded-full text-white flex items-center justify-center pointer-events-none"
                style={{
                  backgroundColor: "#ef4444",
                  fontSize: "9px",
                  fontWeight: 600,
                }}
              >
                {friendRequests.length}
              </span>
            )}
          </button>

          <UserMenuDropdown
            profile={profile}
            initials={profile.initials}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            optionsOpen={optionsOpen}
            setOptionsOpen={setOptionsOpen}
            menuRef={menuRef}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenChangePassword={() => setShowChangePass(true)}
            onOpenChangeE2ePassphrase={
              peerConnection.e2eState === "unlocked"
                ? () => setShowE2eChangePass(true)
                : undefined
            }
            darkMode={darkMode}
            onToggleDark={onToggleDark}
            onLogout={() => logoutWithPeerRevoke(onLogout)}
          />
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {friendsTab && (
          <FriendsPage
            currentTab={friendsTab}
            onChangeTab={handleFriendsChangeTab}
            onClose={closeFriendsPage}
            onOpenRoomDirect={(uid, pid, name) => {
              closeFriendsPage()
              openChatWith(name || "", initialsOf(name || "?"), pid)
            }}
            onStartCall={(uid, pid, name, video) => {
              closeFriendsPage()
              const initials = initialsOf(name || "?")
              openChatWith(name || "", initials, pid).then(() => {
                const targetConv = conversations.find(
                  (c) =>
                    !c.isGroup &&
                    (c.name === name ||
                      (pid && c.members?.some((m) => m.publicId === pid))),
                )
                if (targetConv) {
                  startCall(video ? "video" : "voice", targetConv)
                }
              })
            }}
            meId={meId}
            conversations={conversations}
            blockedUsers={blockedList}
            onBlockUser={(name, initials, opts) =>
              addBlocked(name, initials, opts)
            }
            onUnblockUser={(id, name) => unblockById(id, name)}
            onFriendAccepted={() => {
              refreshFriendList()
            }}
          />
        )}

        <div className={`flex flex-1 overflow-hidden ${friendsTab ? "hidden" : ""}`}>
          <ConversationSidebar
            conversations={conversations}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            setRoomInfoOpen={setRoomInfoOpen}
            setConversations={setConversations}
            search={search}
            setSearch={setSearch}
            onOpenCreateRoom={() => setShowCreateRoom(true)}
            onOpenFindFriends={() => openFriendsPage("suggestions")}
            meId={meId}
            e2eState={peerConnection.e2eState}
            onUnlock={(pass) => peerConnection.unlockWithPassphrase(pass)}
            onLock={() => peerConnection.lockKeystore()}
            onOpenChangePassphrase={() => setShowE2eChangePass(true)}
            onResetKeystore={requestResetKeystore}
          />

        {/* Chat area */}
        <div className="flex-1 flex overflow-hidden">
          <div
            className="flex-1 flex flex-col overflow-hidden"
            style={
              {
                "--chat-theme-color": selected.theme ?? "var(--primary)",
                "--chat-theme-icon": themeIcon(selected),
              } as React.CSSProperties
            }
          >
            <ChatHeader
              selected={selected}
              selectedTransport={peerTransport[selected.realId ?? 0]}
              meId={meId}
              searchOpen={searchOpen}
              searchQuery={searchQuery}
              searchIdx={searchIdx}
              computeSearch={computeSearch}
              focusSearchResult={focusSearchResult}
              setSearchQuery={setSearchQuery}
              setSearchIdx={setSearchIdx}
              setSearchCurId={setSearchCurId}
              jumpToSearch={jumpToSearch}
              closeSearch={closeSearch}
              openSearch={openSearch}
              openOtherProfile={openOtherProfile}
              startCall={(k) => void startCall(k, selected)}
              callBusy={callBusy}
              roomInfoOpen={roomInfoOpen}
              setRoomInfoOpen={setRoomInfoOpen}
            />

            {peerNotice && (
              <div
                className="px-4 py-2 text-xs text-center flex-shrink-0"
                style={{
                  backgroundColor: "var(--surface)",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--muted)",
                }}
              >
                {peerNotice}
              </div>
            )}

            <MessageList
              scrollRef={scrollRef}
              chatEndRef={chatEndRef}
              onScroll={handleScroll}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              dragOver={dragOver}
              selected={selected}
              visibleMessages={visibleMessages}
              meId={meId}
              historyLoading={chatMessages.historyLoading}
              activeActionsId={activeActionsId}
              setActiveActionsId={setActiveActionsId}
              jumpId={jumpId}
              searchCurId={searchCurId}
              highlightBody={highlightBody}
              startEdit={startEdit}
              recallEveryone={recallEveryone}
              deleteForMe={deleteForMe}
              toggleReaction={toggleReaction}
              openShare={openShare}
              startReply={startReply}
              jumpToMessage={jumpToMessage}
              openLightbox={openLightbox}
              setReactionMsgId={setReactionMsgId}
              setReactionTab={setReactionTab}
              setSeenModalMsg={setSeenModalMsg}
              retryOutgoing={retryOutgoing}
              call={call}
              callDur={callDur}
              startCall={startCall}
              showJump={showJump}
              jumpToBottom={jumpToBottom}
              onDownloadFile={(msg) => {
                const f = msg.file
                if (!f) return
                if (!f.fileId) {
                  pushToast("Tệp này chưa có trên máy — cần bên gửi còn trực tuyến")
                  return
                }
                void chatMessages.openPeerFile(f.fileId).then((r) => {
                  if (!r.url) {
                    pushToast("Không mở được tệp: " + (r.error ?? "unknown"))
                    return
                  }
                  const a = document.createElement("a")
                  a.href = r.url
                  a.download = f.name
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                  setTimeout(() => URL.revokeObjectURL(r.url!), 1000)
                })
              }}
              onCancelFile={(fileId) => chatMessages.cancelPeerFile(fileId)}
              onRetryFile={(fileId) => chatMessages.retryPeerFile(fileId)}
            />

            <MessageInput
              typing={typing}
              selectedId={selectedId}
              selected={selected}
              editingId={editingId}
              cancelEdit={cancelEdit}
              replyToId={replyToId}
              cancelReply={cancelReply}
              recState={recState}
              recUrl={recUrl}
              recDuration={recDuration}
              recSeconds={recSeconds}
              sendVoice={() => sendVoice()}
              cancelPreview={cancelPreview}
              startRecording={startRecording}
              stopRecording={stopRecording}
              fileInputRef={fileInputRef}
              imageInputRef={imageInputRef}
              messageInputRef={messageInputRef}
              handleFileInput={handleFileInput}
              handleImageInput={handleImageInput}
              messageInput={messageInput}
              setMessageInput={setMessageInput}
              peerOnRef={peerOnRef}
              lastTypingSentRef={lastTypingSentRef}
              peerRef={peerRef}
              peerReady={peerReady}
              sendMessage={sendMessage}
              sendLike={sendLike}
              emojiOpen={emojiOpen}
              setEmojiOpen={setEmojiOpen}
              emojiBtnRef={emojiBtnRef}
              emojiPanelRef={emojiPanelRef}
              emojiQuery={emojiQuery}
              setEmojiQuery={setEmojiQuery}
              emojiTab={emojiTab}
              setEmojiTab={setEmojiTab}
              recentEmojis={recentEmojis}
              insertEmojiAtCursor={insertEmojiAtCursor}
              myMemberId={meId}
            />
          </div>

          {roomInfoOpen && (
            <InfoPanel
              conv={selected}
              admins={getAdmins()}
              myMemberId={meId}
              friendCandidates={friendList.filter(
                (f) =>
                  !selected.members?.some(
                    (m) =>
                      (m.id !== undefined && f.id !== undefined && m.id === f.id) ||
                      (m.publicId && f.publicId && m.publicId === f.publicId) ||
                      m.name === f.name,
                  ),
              )}
              onPatch={patchConversation}
              onToggleAdmin={toggleAdmin}
              onRemoveMember={removeMemberAndClean}
              onAddMembers={async (members) => {
                const rid = selected.realId
                if (rid === undefined) {
                  pushToast("Không thêm được — phòng chưa đồng bộ với máy chủ")
                  return
                }

                // Nếu là cuộc trò chuyện 1-1 (phòng trực tiếp giới hạn 2 người),
                // khi thêm bạn sẽ tạo nhóm trò chuyện mới gồm người hiện tại + bạn mới.
                if (!selected.isGroup) {
                  const memberIds = new Set<number>()
                  for (const m of selected.members ?? []) {
                    if (m.id && m.id !== meId) memberIds.add(m.id)
                  }
                  for (const m of members) {
                    if (m.id && m.id !== meId) memberIds.add(m.id)
                  }
                  if (memberIds.size === 0) return
                  const groupName = [selected.name, ...members.map((m) => m.name)].slice(0, 3).join(", ")
                  const res = await api.roomCreate({
                    name: groupName,
                    member_ids: Array.from(memberIds),
                  })
                  if (res.ok && res.data?.room) {
                    joinJoinedRoomApi(res.data.room)
                    pushToast(`Đã tạo nhóm mới với ${memberIds.size + 1} thành viên`)
                  } else {
                    pushToast(res.error || "Không tạo được nhóm mới")
                  }
                  return
                }

                let lastRoom: ApiRoom | undefined
                let added = 0
                let already = 0
                let failed = 0
                let lastErrStatus = 0
                for (const m of members) {
                  const r = await api.roomMemberAdd(rid, m.id)
                  if (r.ok && r.data) {
                    lastRoom = r.data.room
                    if (r.data.already_member) already++
                    else added++
                  } else {
                    failed++
                    lastErrStatus = r.status
                  }
                }
                if (lastRoom) {
                  mergeRooms([lastRoom])
                  const room = lastRoom
                  patchConversation({
                    members: room.members.map((m) => ({
                      id: m.id,
                      name: m.display_name || m.username,
                      initials: initialsOf(m.display_name || m.username),
                      online: m.online,
                      publicId: m.public_id,
                      avatar: m.avatar || undefined,
                    })),
                  })
                }
                const parts: string[] = []
                if (added > 0) parts.push(`Đã thêm ${added} người vào nhóm`)
                if (already > 0) parts.push(`${already} người đã ở trong nhóm`)
                if (failed > 0) {
                  parts.push(
                    lastErrStatus === 403
                      ? "Chỉ thêm được bạn bè"
                      : lastErrStatus === 400
                        ? "Phòng đã đầy"
                        : `${failed} người không thêm được`,
                  )
                }
                if (parts.length) pushToast(parts.join(" — "))
              }}
              onViewMember={(m) =>
                openOtherProfile({
                  name: m.name,
                  initials: m.initials,
                  avatar: m.avatar,
                  publicId: m.publicId,
                  online: m.online,
                })
              }
              onLeaveRoom={leaveRoom}
              onBlock={blockUser}
              onUnblock={unblockUser}
              onDeleteChat={deleteChat}
              onReport={reportConversation}
              onPushToast={pushToast}
              onClose={() => setRoomInfoOpen(false)}
              onOpenLightbox={openLightbox}
              onDownloadFile={(msg) => {
                const f = msg.file
                if (!f) return
                if (!f.fileId) {
                  pushToast("Tệp này chưa có trên máy")
                  return
                }
                void chatMessages.openPeerFile(f.fileId).then((r) => {
                  if (!r.url) {
                    pushToast("Không mở được tệp: " + (r.error ?? "unknown"))
                    return
                  }
                  const a = document.createElement("a")
                  a.href = r.url
                  a.download = f.name
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                  setTimeout(() => URL.revokeObjectURL(r.url!), 1000)
                })
              }}
            />
          )}
        </div>
        </div>
      </div>

      {seenModalMsg && (
        <SeenByModal msg={seenModalMsg} onClose={() => setSeenModalMsg(null)} />
      )}

      <CallOverlayContainer callManager={callManager} netQuality={netState.quality} />

      {showE2eChangePass && (
        <E2eChangePassModal
          isOpen={showE2eChangePass}
          onClose={() => setShowE2eChangePass(false)}
          onSuccess={() => {
            chatMessages.reDecryptPendingMessages(selectedRoomIdRef.current)
          }}
          isUnlocked={peerConnection.e2eState === "unlocked"}
          userEmail={profile.email}
          onApplyNewPassphrase={(ticket, newPass) =>
            peerConnection.changePassphraseWithTicket(ticket, newPass)
          }
        />
      )}

      <ProfileModals
        showChangePass={showChangePass}
        setShowChangePass={setShowChangePass}
        showChangeEmail={showChangeEmail}
        setShowChangeEmail={setShowChangeEmail}
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        profile={profile}
        phonePublic={phonePublic}
        blockedUsers={blockedList}
        onSaveProfile={handleSaveProfile}
        onUnblockById={unblockById}
        onTogglePhonePublic={togglePhonePublic}
        onEmailUpdated={handleEmailUpdated}
        onSessionEnded={() => onLogout()}
        showFindFriends={showFindFriends}
        setShowFindFriends={setShowFindFriends}
        findSeed={findSeed}
        setFindSeed={setFindSeed}
        onInviteConsumed={onInviteConsumed}
        onJoinJoinedRoomApi={joinJoinedRoomApi}
        onRefreshRooms={refreshRooms}
        onOpenOtherProfile={openOtherProfile}
        viewProfile={viewProfile}
        setViewProfile={setViewProfile}
        viewCtx={viewCtx}
        onViewUnblock={viewUnblock}
        onViewBlock={viewBlock}
        onOpenChatWith={openChatWith}
        pushToast={pushToast}
      />

      {showCreateRoom && (
        <CreateRoomModal
          onClose={() => setShowCreateRoom(false)}
          onCreate={createRoom}
        />
      )}

      <BlockSharedModal
        blockShared={blockShared}
        onClose={() => setBlockShared(null)}
        onStay={stayInSharedGroups}
        onLeave={leaveSharedGroups}
      />

      <MediaPreviewModal
        mediaPreview={mediaPreview}
        previewPlayUrl={previewPlayUrl}
        setPreviewPlayUrl={setPreviewPlayUrl}
        onCancel={() => {
          mediaPreview?.forEach((m) => URL.revokeObjectURL(m.url))
          setMediaPreview(null)
          setPreviewPlayUrl(null)
        }}
        onConfirm={confirmSendMedia}
      />

      <MediaLightboxModal
        lightbox={lightbox}
        setLightbox={setLightbox}
        stepLightbox={stepLightbox}
        thumbStripRef={thumbStripRef}
        onClose={() => setLightbox(null)}
      />

      <ShareMessageModal
        shareMsg={shareMsg}
        conversations={conversations}
        selectedId={selectedId}
        shareQuery={shareQuery}
        setShareQuery={setShareQuery}
        shareTargets={shareTargets}
        toggleShareTarget={toggleShareTarget}
        shareCaption={shareCaption}
        setShareCaption={setShareCaption}
        onClose={() => setShareMsg(null)}
        onSend={sendShared}
      />

      <ReactionViewModal
        reactionMsgId={reactionMsgId}
        selected={selected}
        reactionTab={reactionTab}
        setReactionTab={setReactionTab}
        onClose={() => setReactionMsgId(null)}
        onRemoveMyReaction={removeMyReaction}
      />

      <RouteMismatchModal
        routeMismatch={routeMismatch}
        onSwitch={handleMismatchSwitch}
        onLogout={handleMismatchLogout}
      />

      {/* Toast container */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="px-4 py-2.5 rounded-xl text-sm shadow-2xl pointer-events-auto flex items-center gap-2 border"
            style={{
              backgroundColor: "rgba(18, 18, 22, 0.95)",
              color: "#fff",
              borderColor: "rgba(255, 255, 255, 0.15)",
              backdropFilter: "blur(12px)",
            }}
          >
            <span className="text-amber-400 font-bold">ℹ</span>
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
