import React, { useState, useEffect, useMemo, useRef, useCallback } from "react"
import {
  api,
  type ApiFriendRequestItem,
  type ApiSentRequestItem,
  type ApiFriendSuggestionItem,
  type ApiPublicUser,
} from "../../lib/api"
import type { FriendsTab } from "../../lib/link"
import type { Conversation } from "../../types/chat"
import { removeVietnameseTones } from "../../lib/vietnamese"
import { FriendCard, type FriendCardData } from "./FriendCard"
import { MiniProfileModal } from "./MiniProfileModal"
import { QrCodeModal } from "./QrCodeModal"

export { removeVietnameseTones }

export interface FriendsPageProps {
  currentTab: FriendsTab
  onChangeTab: (tab: FriendsTab) => void
  onClose: () => void
  onOpenRoomDirect: (
    otherUserId: number,
    otherPublicId?: string,
    displayName?: string,
  ) => void
  onStartCall?: (
    otherUserId: number,
    otherPublicId?: string,
    displayName?: string,
    video?: boolean,
  ) => void
  meId: number
  conversations: Conversation[]
  blockedUsers: { id: number; name: string; initials: string; avatarUrl?: string }[]
  onBlockUser: (name: string, initials: string, opts?: { id?: number }) => void
  onUnblockUser: (id: number, name: string) => void
  onFriendAccepted?: () => void
  onUpdatePendingCount?: (count: number) => void
}

const PAGE_SIZE = 24

export function FriendsPage({
  currentTab,
  onChangeTab,
  onClose,
  onOpenRoomDirect,
  onStartCall,
  meId,
  conversations,
  blockedUsers,
  onBlockUser,
  onUnblockUser,
  onFriendAccepted,
  onUpdatePendingCount,
}: FriendsPageProps) {
  // Dữ liệu cho từng tab
  const [requests, setRequests] = useState<ApiFriendRequestItem[]>([])
  const [sentRequests, setSentRequests] = useState<ApiSentRequestItem[]>([])
  const [suggestions, setSuggestions] = useState<ApiFriendSuggestionItem[]>([])
  const [friends, setFriends] = useState<ApiPublicUser[]>([])

  // Trạng thái tải & lỗi
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Tìm kiếm
  const [searchQuery, setSearchQuery] = useState("")
  // Tìm người lạ bằng tên, username, email trong tab Gợi ý
  const [strangerQuery, setStrangerQuery] = useState("")
  const [strangerResults, setStrangerResults] = useState<ApiPublicUser[]>([])
  const [strangerSearching, setStrangerSearching] = useState(false)
  const [strangerError, setStrangerError] = useState("")

  // Modal Mã QR & Liên kết
  const [qrModalOpen, setQrModalOpen] = useState(false)

  // Phân trang: hiển thị tối đa visibleCount
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Hồ sơ nhỏ đang mở
  const [selectedProfile, setSelectedProfile] = useState<FriendCardData | null>(null)

  // Danh sách ID người bị chặn
  const blockedNames = useMemo(
    () => new Set(blockedUsers.map((b) => b.name)),
    [blockedUsers],
  )

  // Ref lưu props mới nhất để loadData không bị re-trigger vô tận
  const propsRef = useRef({
    conversations,
    meId,
    blockedUsers,
    onFriendAccepted,
    onUpdatePendingCount,
  })
  useEffect(() => {
    propsRef.current = {
      conversations,
      meId,
      blockedUsers,
      onFriendAccepted,
      onUpdatePendingCount,
    }
  })

  // Đánh dấu các tab đã tải dữ liệu thành công ít nhất một lần để tránh chớp giật skeleton
  const loadedTabsRef = useRef<Set<FriendsTab>>(new Set())

  // Tải dữ liệu cho tab chỉ định (silent = true khi thăm dò ngầm, không bật loader giật giật)
  const loadData = useCallback(async (tab: FriendsTab, silent = false) => {
    const isFirstLoad = !loadedTabsRef.current.has(tab)
    if (isFirstLoad && !silent) {
      setLoading(true)
    }
    setErrorMsg(null)

    try {
      if (tab === "requests") {
        const res = await api.friendRequests()
        if (res.ok && res.data) {
          const list = res.data.requests || []
          setRequests(list)
          loadedTabsRef.current.add("requests")
          propsRef.current.onUpdatePendingCount?.(list.length)
        } else if (isFirstLoad) {
          setErrorMsg("Không thể tải danh sách lời mời kết bạn")
        }
      } else if (tab === "sent") {
        const res = await api.friendSentList()
        if (res.ok && res.data) {
          setSentRequests(res.data.requests || [])
          loadedTabsRef.current.add("sent")
        } else if (isFirstLoad) {
          setErrorMsg("Không thể tải danh sách lời mời đã gửi")
        }
      } else if (tab === "all") {
        const res = await api.friendsList()
        if (res.ok && res.data) {
          setFriends(res.data.friends || [])
          loadedTabsRef.current.add("all")
        } else if (isFirstLoad) {
          setErrorMsg("Không thể tải danh sách bạn bè")
        }
      } else if (tab === "suggestions") {
        // Tải đồng thời gợi ý, danh sách bạn bè và lời mời để loại trừ triệt để bạn bè đã kết bạn
        const [sugRes, friendsRes, reqRes, sentRes] = await Promise.all([
          api.friendSuggestions().catch(() => ({ ok: false, data: undefined })),
          api.friendsList().catch(() => ({ ok: false, data: undefined })),
          api.friendRequests().catch(() => ({ ok: false, data: undefined })),
          api.friendSentList().catch(() => ({ ok: false, data: undefined })),
        ])

        const currentFriends =
          friendsRes.ok && friendsRes.data?.friends ? friendsRes.data.friends : []
        if (currentFriends.length > 0) {
          setFriends(currentFriends)
        }

        // Tập hợp danh sách ID, publicId và tên của tất cả bạn bè hiện có
        const friendIds = new Set<number>()
        const friendPublicIds = new Set<string>()
        const friendNames = new Set<string>()

        currentFriends.forEach((f) => {
          if (f.id) friendIds.add(f.id)
          if (f.public_id) friendPublicIds.add(f.public_id)
          if (f.display_name) friendNames.add(f.display_name.trim().toLowerCase())
          if (f.username) friendNames.add(f.username.trim().toLowerCase())
        })

        // Bổ sung bạn bè từ các phòng 1-1
        propsRef.current.conversations.forEach((c) => {
          if (!c.isGroup && c.name) {
            friendNames.add(c.name.trim().toLowerCase())
          }
          if (!c.isGroup && c.members) {
            c.members.forEach((m) => {
              if (m.id && m.id !== propsRef.current.meId) friendIds.add(m.id)
              if (m.publicId) friendPublicIds.add(m.publicId)
              if (m.name) friendNames.add(m.name.trim().toLowerCase())
              if (m.username) friendNames.add(m.username.trim().toLowerCase())
            })
          }
        })

        // Tập hợp những ai đang pending (gửi hoặc nhận)
        const pendingPublicIds = new Set<string>()
        const pendingNames = new Set<string>()
        if (reqRes.ok && reqRes.data?.requests) {
          reqRes.data.requests.forEach((r) => {
            if (r.from.public_id) pendingPublicIds.add(r.from.public_id)
            if (r.from.display_name)
              pendingNames.add(r.from.display_name.trim().toLowerCase())
            if (r.from.username)
              pendingNames.add(r.from.username.trim().toLowerCase())
          })
        }
        if (sentRes.ok && sentRes.data?.requests) {
          sentRes.data.requests.forEach((r) => {
            if (r.to.id) friendIds.add(r.to.id)
            if (r.to.public_id) pendingPublicIds.add(r.to.public_id)
            if (r.to.display_name)
              pendingNames.add(r.to.display_name.trim().toLowerCase())
            if (r.to.username)
              pendingNames.add(r.to.username.trim().toLowerCase())
          })
        }

        const blockedSet = new Set(
          propsRef.current.blockedUsers.map((b) => b.name.trim().toLowerCase()),
        )

        // Kiểm tra xem ứng viên có bị loại trừ không
        const isCandidateExcluded = (
          id?: number,
          publicId?: string,
          name?: string,
          username?: string,
        ) => {
          if (id && (id === propsRef.current.meId || friendIds.has(id))) return true
          if (
            publicId &&
            (friendPublicIds.has(publicId) || pendingPublicIds.has(publicId))
          )
            return true
          const lowerName = name?.trim().toLowerCase()
          const lowerUser = username?.trim().toLowerCase()
          if (
            lowerName &&
            (friendNames.has(lowerName) ||
              pendingNames.has(lowerName) ||
              blockedSet.has(lowerName))
          )
            return true
          if (
            lowerUser &&
            (friendNames.has(lowerUser) || pendingNames.has(lowerUser))
          )
            return true
          return false
        }

        if (sugRes.ok && sugRes.data?.suggestions) {
          const clean = sugRes.data.suggestions.filter(
            (s) =>
              !isCandidateExcluded(
                s.id,
                s.public_id,
                s.display_name,
                s.username,
              ),
          )
          setSuggestions(clean)
          loadedTabsRef.current.add("suggestions")
        } else {
          // Fallback: tính từ phòng chung và LOẠI TRỪ 100% BẠN BÈ ĐÃ KẾT BẠN
          const sharedUsers: ApiFriendSuggestionItem[] = []
          propsRef.current.conversations.forEach((c) => {
            if (c.isGroup && c.members) {
              c.members.forEach((m) => {
                if (
                  !isCandidateExcluded(m.id, m.publicId, m.name, m.username) &&
                  !sharedUsers.some(
                    (u) =>
                      (m.id && u.id === m.id) ||
                      (m.publicId && u.public_id === m.publicId) ||
                      u.display_name === m.name,
                  )
                ) {
                  sharedUsers.push({
                    id: m.id,
                    public_id: m.publicId || String(m.id),
                    username: m.username || "",
                    display_name: m.name,
                    avatar: m.avatar || "",
                    mutual_count: 0,
                    shared_rooms: 1,
                  })
                }
              })
            }
          })
          setSuggestions(sharedUsers)
          loadedTabsRef.current.add("suggestions")
        }
      }
    } catch {
      if (isFirstLoad) {
        setErrorMsg("Đã xảy ra lỗi khi kết nối máy chủ")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Chỉ gọi loadData khi currentTab thực sự thay đổi
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setSearchQuery("")
    setStrangerQuery("")
    setStrangerResults([])
    setStrangerError("")
    loadData(currentTab)
  }, [currentTab, loadData])

  // Thăm dò định kỳ 30s: Tải ngầm hoàn toàn trong background, không bật skeleton
  useEffect(() => {
    const timer = setInterval(() => {
      loadData(currentTab, true)
    }, 30000)
    return () => clearInterval(timer)
  }, [currentTab, loadData])

  // Lắng nghe phím Esc để đóng trang (nếu không có modal hồ sơ mở)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!selectedProfile) {
          e.preventDefault()
          onClose()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedProfile, onClose])

  // --- CÁC HÀNH ĐỘNG VỚI BẠN BÈ ---

  // 1. Xác nhận kết bạn
  const handleConfirmRequest = async (item: FriendCardData) => {
    if (!item.requestId) return
    const prev = [...requests]
    // Cập nhật lạc quan
    setRequests((cur) => cur.filter((r) => r.request_id !== item.requestId))
    if (onUpdatePendingCount) onUpdatePendingCount(prev.length - 1)
    const res = await api.acceptFriend(item.requestId)
    if (!res.ok) {
      setRequests(prev)
      if (onUpdatePendingCount) onUpdatePendingCount(prev.length)
      alert("Không thể chấp nhận lời mời. Vui lòng thử lại.")
    } else {
      if (onFriendAccepted) onFriendAccepted()
    }
  }

  // 2. Xóa lời mời nhận
  const handleRejectRequest = async (item: FriendCardData) => {
    if (!item.requestId) return
    const prev = [...requests]
    setRequests((cur) => cur.filter((r) => r.request_id !== item.requestId))
    if (onUpdatePendingCount) onUpdatePendingCount(prev.length - 1)
    const res = await api.rejectFriend(item.requestId)
    if (!res.ok) {
      setRequests(prev)
      if (onUpdatePendingCount) onUpdatePendingCount(prev.length)
      alert("Không thể xóa lời mời. Vui lòng thử lại.")
    }
  }

  // 3. Hủy lời mời đã gửi
  const handleCancelSent = async (item: FriendCardData) => {
    if (!item.requestId) return
    const prev = [...sentRequests]
    setSentRequests((cur) => cur.filter((r) => r.request_id !== item.requestId))
    const res = await api.cancelFriend(item.requestId)
    if (!res.ok) {
      setSentRequests(prev)
      alert("Không thể hủy lời mời. Vui lòng thử lại.")
    }
  }

  // 4. Thêm bạn (gửi lời mời)
  const handleAddFriend = async (item: FriendCardData) => {
    const prev = [...suggestions]
    setSuggestions((cur) => cur.filter((s) => s.public_id !== item.publicId))
    const res = await api.requestFriend(item.publicId)
    if (!res.ok) {
      setSuggestions(prev)
      alert("Không thể gửi lời mời kết bạn. Vui lòng thử lại.")
    }
  }

  // 5. Gỡ gợi ý
  const handleRemoveSuggestion = (item: FriendCardData) => {
    setSuggestions((cur) => cur.filter((s) => s.public_id !== item.publicId))
  }

  // 6. Nhắn tin: đóng trang và mở cuộc trò chuyện trực tiếp
  const handleMessage = (item: FriendCardData) => {
    onClose()
    if (item.id) {
      onOpenRoomDirect(item.id, item.publicId, item.displayName)
    }
  }

  // 7. Gọi điện
  const handleCall = (item: FriendCardData) => {
    if (onStartCall && item.id) {
      onStartCall(item.id, item.publicId, item.displayName, false)
    }
  }

  // 8. Hủy kết bạn
  const handleUnfriend = async (item: FriendCardData) => {
    const prev = [...friends]
    setFriends((cur) => cur.filter((f) => f.public_id !== item.publicId))
    const targetId = item.id || item.publicId
    const res = await api.unfriend(targetId)
    if (!res.ok) {
      setFriends(prev)
      alert("Không thể hủy kết bạn. Vui lòng thử lại.")
    }
  }

  // 9. Chặn
  const handleBlock = async (item: FriendCardData) => {
    onBlockUser(item.displayName, item.displayName.slice(0, 2).toUpperCase(), {
      id: item.id,
    })
    setFriends((cur) => cur.filter((f) => f.public_id !== item.publicId))
  }

  // 10. Bỏ chặn
  const handleUnblock = async (item: FriendCardData) => {
    if (item.id) {
      onUnblockUser(item.id, item.displayName)
    }
  }

  // 11. Tìm người lạ theo tên, username, email, mã liên kết
  const handleSearchStrangerWithQuery = async (queryText: string) => {
    const q = queryText.trim()
    if (!q) return
    setStrangerSearching(true)
    setStrangerError("")
    setStrangerResults([])
    try {
      const res = await api.searchUser(q)
      if (res.ok && res.data?.users && res.data.users.length > 0) {
        const filtered = res.data.users.filter(
          (u) =>
            u.id !== meId && !blockedNames.has(u.display_name || u.username),
        )
        if (filtered.length > 0) {
          setStrangerResults(filtered)
        } else {
          setStrangerError(
            "Không tìm thấy người dùng phù hợp (có thể là chính bạn hoặc trong danh sách chặn).",
          )
        }
      } else {
        setStrangerError(
          "Không tìm thấy người dùng nào với thông tin này. Bạn có thể tìm bằng tên hiển thị, @username, email hoặc dán liên kết /u/...",
        )
      }
    } catch {
      setStrangerError("Đã xảy ra lỗi khi tìm kiếm")
    } finally {
      setStrangerSearching(false)
    }
  }

  const handleSearchStranger = (e: React.FormEvent) => {
    e.preventDefault()
    handleSearchStrangerWithQuery(strangerQuery)
  }

  const handleAddStrangerFriend = async (u: ApiPublicUser) => {
    const pid = u.public_id || u.username
    if (!pid) return
    const res = await api.requestFriend(pid)
    if (res.ok) {
      setStrangerResults((cur) =>
        cur.map((x) =>
          x.id === u.id
            ? {
                ...x,
                relation:
                  res.data?.outcome === "accepted" ? "friend" : "pending_sent",
              }
            : x,
        ),
      )
    } else {
      alert("Không thể gửi lời mời kết bạn. Vui lòng thử lại.")
    }
  }

  // Lọc danh sách Tất cả bạn bè theo tên không dấu
  const filteredFriends = useMemo(() => {
    if (currentTab !== "all") return []
    let list = friends.filter((f) => !blockedNames.has(f.display_name || f.username))
    if (searchQuery.trim()) {
      const normQuery = removeVietnameseTones(searchQuery)
      list = list.filter((f) => {
        const normName = removeVietnameseTones(f.display_name || "")
        const normUser = removeVietnameseTones(f.username || "")
        return normName.includes(normQuery) || normUser.includes(normQuery)
      })
    }
    return list
  }, [currentTab, friends, blockedNames, searchQuery])

  // Chuyển đổi dữ liệu hiển thị thành mảng FriendCardData
  const displayItems: FriendCardData[] = useMemo(() => {
    if (currentTab === "requests") {
      return requests.map((r) => ({
        id: undefined,
        publicId: r.from.public_id,
        displayName: r.from.display_name,
        username: r.from.username,
        avatarUrl: r.from.avatar,
        requestId: r.request_id,
        createdAt: r.created_at,
      }))
    }
    if (currentTab === "sent") {
      return sentRequests.map((r) => ({
        id: r.to.id,
        publicId: r.to.public_id,
        displayName: r.to.display_name,
        username: r.to.username,
        avatarUrl: r.to.avatar,
        requestId: r.request_id,
        createdAt: r.created_at,
      }))
    }
    if (currentTab === "suggestions") {
      const friendIds = new Set<number>()
      const friendPublicIds = new Set<string>()
      const friendNames = new Set<string>()

      friends.forEach((f) => {
        if (f.id) friendIds.add(f.id)
        if (f.public_id) friendPublicIds.add(f.public_id)
        if (f.display_name) friendNames.add(f.display_name.trim().toLowerCase())
        if (f.username) friendNames.add(f.username.trim().toLowerCase())
      })

      conversations.forEach((c) => {
        if (!c.isGroup && c.name) {
          friendNames.add(c.name.trim().toLowerCase())
        }
        if (!c.isGroup && c.members) {
          c.members.forEach((m) => {
            if (m.id && m.id !== meId) friendIds.add(m.id)
            if (m.publicId) friendPublicIds.add(m.publicId)
            if (m.name) friendNames.add(m.name.trim().toLowerCase())
            if (m.username) friendNames.add(m.username.trim().toLowerCase())
          })
        }
      })

      return suggestions
        .filter((s) => {
          if (s.id && (s.id === meId || friendIds.has(s.id))) return false
          if (s.public_id && friendPublicIds.has(s.public_id)) return false
          const lowerName = (s.display_name || "").trim().toLowerCase()
          const lowerUser = (s.username || "").trim().toLowerCase()
          if (
            lowerName &&
            (friendNames.has(lowerName) || blockedNames.has(s.display_name))
          ) {
            return false
          }
          if (
            lowerUser &&
            (friendNames.has(lowerUser) || blockedNames.has(s.username))
          ) {
            return false
          }
          return true
        })
        .map((s) => ({
          id: s.id,
          publicId: s.public_id,
          displayName: s.display_name,
          username: s.username,
          avatarUrl: s.avatar,
          mutualCount: s.mutual_count,
          sharedRooms: s.shared_rooms,
        }))
    }
    if (currentTab === "all") {
      return filteredFriends.map((f) => {
        let sharedRooms = 0
        const fName = (f.display_name || f.username || "").trim().toLowerCase()
        conversations.forEach((c) => {
          if (c.isGroup && c.members) {
            if (
              c.members.some(
                (m) =>
                  (f.id && m.id === f.id) ||
                  (f.public_id && m.publicId === f.public_id) ||
                  (fName && m.name.trim().toLowerCase() === fName),
              )
            ) {
              sharedRooms++
            }
          }
        })

        return {
          id: f.id,
          publicId: f.public_id,
          displayName: f.display_name || f.username,
          username: f.username,
          avatarUrl: f.avatar,
          online: f.online,
          bio: f.bio,
          coverUrl: f.cover,
          sharedRooms: sharedRooms > 0 ? sharedRooms : undefined,
        }
      })
    }
    if (currentTab === "blocked") {
      return blockedUsers.map((b) => ({
        id: b.id,
        publicId: String(b.id),
        displayName: b.name,
        avatarUrl: b.avatarUrl,
        subtitle: "Đã chặn",
      }))
    }
    return []
  }, [
    currentTab,
    requests,
    sentRequests,
    suggestions,
    filteredFriends,
    friends,
    conversations,
    meId,
    blockedUsers,
    blockedNames,
  ])

  // Phân trang
  const paginatedItems = useMemo(() => {
    return displayItems.slice(0, visibleCount)
  }, [displayItems, visibleCount])

  // Tiêu đề cho khung nội dung
  const tabTitles: Record<FriendsTab, string> = {
    requests: "Lời mời kết bạn",
    sent: "Lời mời đã gửi",
    suggestions: "Gợi ý kết bạn",
    all: "Tất cả bạn bè",
    blocked: "Danh sách đã chặn",
  }

  // Danh sách các mục menu bên trái
  const menuItems: { id: FriendsTab; label: string; count?: number; icon: React.ReactNode }[] = [
    {
      id: "requests",
      label: "Lời mời kết bạn",
      count: requests.length > 0 ? requests.length : undefined,
      icon: (
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
      ),
    },
    {
      id: "sent",
      label: "Đã gửi",
      icon: (
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
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      ),
    },
    {
      id: "suggestions",
      label: "Gợi ý",
      icon: (
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
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      id: "all",
      label: "Tất cả bạn bè",
      icon: (
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
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      id: "blocked",
      label: "Đã chặn",
      icon: (
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
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      ),
    },
  ]

  return (
    <div
      role="region"
      aria-label="Trang Bạn bè"
      className="flex-1 flex flex-col md:flex-row overflow-hidden w-full h-full select-none"
      style={{ backgroundColor: "var(--bg)" }}
    >
      {/* CỘT MENU TRÁI CỐ ĐỊNH (Desktop) & THANH TAB NGANG (Mobile) */}
      <nav
        aria-label="Điều hướng Bạn bè"
        className="w-full md:w-72 shrink-0 flex flex-col border-b md:border-b-0 md:border-r overflow-y-auto"
        style={{
          backgroundColor: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="p-4 border-b hidden md:block" style={{ borderColor: "var(--border)" }}>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
            Bạn bè
          </h1>
        </div>

        {/* Danh sách tab: Trên mobile cuộn ngang, trên desktop xếp dọc */}
        <div className="p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible no-scrollbar">
          {/* Mục "Trang chủ" quay về chat */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-colors shrink-0 text-left hover:opacity-80"
            style={{
              color: "var(--muted)",
              backgroundColor: "transparent",
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
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>Trang chủ</span>
          </button>

          {/* Các mục con của Bạn bè */}
          {menuItems.map((item) => {
            const isActive = currentTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeTab(item.id)}
                aria-current={isActive ? "page" : undefined}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-colors shrink-0 text-left"
                style={{
                  backgroundColor: isActive ? "var(--primary)" : "transparent",
                  color: isActive ? "#ffffff" : "var(--text)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span className={isActive ? "text-white" : "text-muted"}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.count !== undefined && (
                  <span
                    className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{
                      backgroundColor: isActive ? "#ffffff" : "#ef4444",
                      color: isActive ? "var(--primary)" : "#ffffff",
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
          {/* Nút mở Mã QR & Liên kết */}
          <button
            type="button"
            onClick={() => setQrModalOpen(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-colors shrink-0 text-left hover:opacity-85 mt-1"
            style={{
              color: "var(--primary)",
              backgroundColor: "transparent",
              border: "1px dashed var(--primary)",
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
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>Mã QR & Liên kết</span>
          </button>
        </div>
      </nav>

      {/* KHUNG NỘI DUNG PHẢI: TIÊU ĐỀ + LƯỚI THẺ + NÚT X ĐÓNG */}
      <main
        tabIndex={0}
        aria-label={`Nội dung ${tabTitles[currentTab]}`}
        className="flex-1 flex flex-col h-full overflow-y-auto relative focus:outline-none"
      >
        {/* Header khung nội dung: Cố định góc trên khi cuộn */}
        <div
          className="sticky top-0 z-10 px-5 md:px-8 py-4 flex items-center justify-between border-b backdrop-blur-md"
          style={{
            backgroundColor: "var(--bg)",
            borderColor: "var(--border)",
          }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg md:text-xl font-bold tracking-tight" style={{ color: "var(--text)" }}>
              {tabTitles[currentTab]}
            </h2>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              {displayItems.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Nút Mã QR & Liên kết */}
            <button
              type="button"
              onClick={() => setQrModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--primary)",
                border: "1px solid var(--border)",
              }}
              title="Mã QR & Liên kết kết bạn"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span className="hidden sm:inline">Mã QR & Liên kết</span>
            </button>

            {/* NÚT ĐÓNG "X" CỐ ĐỊNH Ở GÓC PHẢI TRÊN */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng, quay về tin nhắn"
              className="w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-75 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              style={{
                backgroundColor: "var(--surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
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
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Thanh công cụ tìm kiếm theo từng tab */}
        <div className="px-5 md:px-8 pt-4 pb-2 flex flex-col gap-3">
          {/* Tab "Tất cả bạn bè": Ô tìm kiếm lọc theo tên bỏ dấu */}
          {currentTab === "all" && (
            <div className="relative max-w-md">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm kiếm trong danh sách bạn bè (hỗ trợ tiếng Việt)..."
                aria-label="Tìm kiếm bạn bè"
                className="w-full pl-9 pr-4 py-2 rounded-xl text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-all"
                style={{
                  backgroundColor: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              />
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3 top-2.5 text-muted pointer-events-none"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Xóa tìm kiếm"
                  className="absolute right-3 top-2.5 text-muted hover:opacity-80"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {/* Tab "Gợi ý": Ô tìm bạn bằng tên, username, email hoặc mã liên kết */}
          {currentTab === "suggestions" && (
            <div className="max-w-xl">
              <form onSubmit={handleSearchStranger} className="flex gap-2">
                <input
                  type="text"
                  value={strangerQuery}
                  onChange={(e) => setStrangerQuery(e.target.value)}
                  placeholder="Tìm bạn bằng tên hiển thị, @username, email hoặc mã /u/..."
                  aria-label="Tìm bạn bằng tên hiển thị, username, email hoặc mã liên kết"
                  className="flex-1 px-4 py-2 rounded-xl text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] transition-all"
                  style={{
                    backgroundColor: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                  }}
                />
                <button
                  type="submit"
                  disabled={strangerSearching || !strangerQuery.trim()}
                  className="px-4 py-2 rounded-xl text-xs md:text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  {strangerSearching ? "Đang tìm..." : "Tìm bạn"}
                </button>
              </form>

              {/* Lỗi tìm kiếm người lạ */}
              {strangerError && (
                <p className="text-xs text-red-500 mt-2">{strangerError}</p>
              )}

              {/* Danh sách kết quả tìm thấy người lạ */}
              {strangerResults.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      Tìm thấy {strangerResults.length} người dùng phù hợp:
                    </span>
                    <button
                      type="button"
                      onClick={() => setStrangerResults([])}
                      className="text-xs hover:underline"
                      style={{ color: "var(--primary)" }}
                    >
                      Đóng kết quả
                    </button>
                  </div>
                  {strangerResults.map((u) => {
                    const isFriend = u.relation === "friend"
                    const isPendingSent = u.relation === "pending_sent"
                    const isPendingReceived = u.relation === "pending_received"
                    return (
                      <div
                        key={u.id}
                        className="p-3 rounded-xl flex items-center justify-between border"
                        style={{
                          backgroundColor: "var(--surface)",
                          borderColor: "var(--border)",
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm select-none"
                            style={{
                              backgroundColor: "var(--bg)",
                              color: "var(--text)",
                            }}
                          >
                            {u.avatar ? (
                              <img
                                src={u.avatar}
                                alt={u.display_name}
                                className="w-full h-full rounded-full object-cover"
                              />
                            ) : (
                              u.display_name?.slice(0, 2).toUpperCase() ||
                              u.username.slice(0, 2).toUpperCase()
                            )}
                          </div>
                          <div>
                            <h4
                              className="text-sm font-semibold"
                              style={{ color: "var(--text)" }}
                            >
                              {u.display_name || u.username}
                            </h4>
                            <p
                              className="text-xs font-mono"
                              style={{ color: "var(--muted)" }}
                            >
                              @{u.username}
                            </p>
                          </div>
                        </div>

                        <div>
                          {isFriend ? (
                            <button
                              type="button"
                              onClick={() => {
                                onClose()
                                onOpenRoomDirect(u.id, u.public_id, u.display_name)
                              }}
                              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                              style={{ backgroundColor: "var(--primary)" }}
                            >
                              Nhắn tin
                            </button>
                          ) : isPendingSent ? (
                            <span
                              className="px-3 py-1.5 rounded-lg text-xs font-medium"
                              style={{
                                backgroundColor: "var(--border)",
                                color: "var(--muted)",
                              }}
                            >
                              Đã gửi lời mời
                            </span>
                          ) : isPendingReceived ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (u.request_id) {
                                  api.acceptFriend(u.request_id).then((r) => {
                                    if (r.ok) {
                                      setStrangerResults((cur) =>
                                        cur.map((x) =>
                                          x.id === u.id
                                            ? { ...x, relation: "friend" }
                                            : x,
                                        ),
                                      )
                                      if (onFriendAccepted) onFriendAccepted()
                                    }
                                  })
                                }
                              }}
                              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-green-600 hover:opacity-90"
                            >
                              Chấp nhận
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAddStrangerFriend(u)}
                              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
                              style={{ backgroundColor: "var(--primary)" }}
                            >
                              Thêm bạn
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* LƯỚI THẺ RESPONSIVE HOẶC TRẠNG THÁI RỖNG / LỖI / SKELETON */}
        <div className="p-5 md:px-8 pb-12 flex-1">
          {/* Trạng thái lỗi */}
          {errorMsg && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {errorMsg}
              </p>
              <button
                type="button"
                onClick={loadData}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "var(--primary)" }}
              >
                Thử lại
              </button>
            </div>
          )}

          {/* Khung tải Skeleton */}
          {loading && !errorMsg && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl overflow-hidden animate-pulse flex flex-col"
                  style={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    className="aspect-square w-full"
                    style={{ backgroundColor: "var(--bg)" }}
                  />
                  <div className="p-3 flex flex-col gap-2">
                    <div
                      className="h-4 w-3/4 rounded"
                      style={{ backgroundColor: "var(--border)" }}
                    />
                    <div
                      className="h-3 w-1/2 rounded"
                      style={{ backgroundColor: "var(--border)" }}
                    />
                    <div
                      className="h-8 w-full rounded-lg mt-2"
                      style={{ backgroundColor: "var(--border)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Trạng thái rỗng */}
          {!loading && !errorMsg && displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "var(--surface)",
                  color: "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <h3 className="text-base font-bold" style={{ color: "var(--text)" }}>
                {currentTab === "requests" && "Không có lời mời kết bạn nào"}
                {currentTab === "sent" && "Bạn chưa gửi lời mời kết bạn nào"}
                {currentTab === "suggestions" && "Chưa có gợi ý kết bạn mới"}
                {currentTab === "all" &&
                  (searchQuery
                    ? "Không tìm thấy bạn bè nào khớp với từ khóa"
                    : "Bạn chưa có bạn bè nào")}
                {currentTab === "blocked" && "Danh sách chặn trống"}
              </h3>
              <p className="text-xs max-w-sm" style={{ color: "var(--muted)" }}>
                {currentTab === "requests" &&
                  "Khi có người gửi lời mời kết bạn, thông tin của họ sẽ xuất hiện tại đây."}
                {currentTab === "sent" &&
                  "Lời mời kết bạn bạn gửi đi cho người khác sẽ được hiển thị tại đây cho tới khi họ chấp nhận."}
                {currentTab === "suggestions" &&
                  "Gợi ý sẽ xuất hiện khi bạn có bạn chung hoặc tham gia cùng các nhóm trò chuyện."}
                {currentTab === "all" &&
                  (searchQuery
                    ? "Hãy thử tìm kiếm với từ khóa khác hoặc bấm nút bên dưới để tìm trong toàn bộ người dùng."
                    : "Hãy khám phá tab Gợi ý hoặc tìm kiếm bằng username để kết nối với mọi người.")}
                {currentTab === "blocked" &&
                  "Những người bạn đã chặn sẽ xuất hiện ở đây. Họ sẽ không thể nhắn tin hay gọi cho bạn."}
              </p>

              {currentTab === "all" && searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    onChangeTab("suggestions")
                    setStrangerQuery(searchQuery)
                    handleSearchStrangerWithQuery(searchQuery)
                  }}
                  className="mt-3 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90 flex items-center gap-2"
                  style={{ backgroundColor: "var(--primary)" }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Tìm &quot;{searchQuery}&quot; trong tất cả người dùng
                </button>
              )}
            </div>
          )}

          {/* LƯỚI THẺ RESPONSIVE 6 -> 4 -> 2 -> 1 */}
          {!loading && !errorMsg && displayItems.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
              {paginatedItems.map((item) => (
                <FriendCard
                  key={item.publicId || item.id || item.requestId}
                  user={item}
                  context={currentTab}
                  onConfirm={handleConfirmRequest}
                  onReject={handleRejectRequest}
                  onCancelRequest={handleCancelSent}
                  onAddFriend={handleAddFriend}
                  onRemoveSuggestion={handleRemoveSuggestion}
                  onMessage={handleMessage}
                  onCall={handleCall}
                  onUnfriend={handleUnfriend}
                  onBlock={handleBlock}
                  onUnblock={handleUnblock}
                  onClickCard={(u) => setSelectedProfile(u)}
                />
              ))}
            </div>
          )}

          {/* Nút "Xem thêm" hoặc phân trang 24 mục/lần */}
          {!loading && displayItems.length > visibleCount && (
            <div className="flex justify-center mt-8">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="px-6 py-2.5 rounded-xl text-xs md:text-sm font-semibold transition-opacity hover:opacity-85 shadow"
                style={{
                  backgroundColor: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                }}
              >
                Xem thêm bạn bè ({displayItems.length - visibleCount} mục nữa)
              </button>
            </div>
          )}
        </div>
      </main>

      {/* MODAL HỒ SƠ THU NHỎ KHI BẤM VÀO THẺ */}
      <MiniProfileModal
        user={selectedProfile}
        context={currentTab}
        onClose={() => setSelectedProfile(null)}
        onConfirm={handleConfirmRequest}
        onReject={handleRejectRequest}
        onCancelRequest={handleCancelSent}
        onAddFriend={handleAddFriend}
        onMessage={handleMessage}
        onCall={handleCall}
        onUnfriend={handleUnfriend}
        onBlock={handleBlock}
        onUnblock={handleUnblock}
      />

      {/* MODAL MÃ QR & LIÊN KẾT KẾT BẠN */}
      <QrCodeModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        onFriendRequested={() => {
          loadData("requests", true)
          loadData("suggestions", true)
        }}
        onOpenRoomDirect={onOpenRoomDirect}
      />
    </div>
  )
}
