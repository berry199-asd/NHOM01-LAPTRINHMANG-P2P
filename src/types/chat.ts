import type { RoomMember } from "../components/CreateRoomModal"

export interface FriendRequest {
  id: number
  name: string
  initials: string
  avatar?: string
  publicId?: string
}

export interface ChatFile {
  name: string
  size: string
  progress: number
  done: boolean
  isImage?: boolean
  isVideo?: boolean
  duration?: number
  url?: string
  chunks?: number
  checksum?: string
  /** Định danh tệp trong kho cục bộ của Peer Core (dùng để xin vé tải). */
  fileId?: string
  /** MIME gốc để hiển thị/tải đúng kiểu. */
  mime?: string
  /** Trạng thái truyền do Peer Core báo: đang gửi/chờ người nhận/đã gửi/lỗi. */
  state?: "sending" | "waiting" | "sent" | "failed" | "cancelled"
  /** ?ang truy?n ch?m (c?a s? ?? b? co) do m?ng y?u. */
  weak?: boolean
  /** Trạng thái từng người nhận (nhóm): userId + waiting|sending|sent|rejected|paused. */
  recipients?: { userId: number; state: string }[]
  /** S? ng??i nh?n ?? x?c nh?n / t?ng s? ng??i nh?n (nh?m). */
  sentTo?: number
  total?: number
}

export interface PeerUploadResult {
  ok: boolean
  chunks?: number
  sha256?: string
  sentTo?: number
  fileId?: string
  error?: string
  message?: string
}

export interface MessageReaction {
  emoji: string
  name: string
  initials: string
  mine?: boolean
}

export interface Message {
  id: number
  clientId?: string
  text: string
  fromMe: boolean
  time: string
  tag?: string
  senderId?: number
  senderName?: string
  senderInitials?: string
  status?: "sent" | "delivered" | "seen" | "sending" | "stored" | "failed"
  /** Tin đã cạn số lần thử tự động — hiện nút "Gửi lại". */
  retryable?: boolean
  /** false = chỉ có metadata server, chưa giải mã → ẩn khỏi giao diện. */
  decrypted?: boolean
  /** true = giải mã thất bại thật sự → hiện 🔒. */
  undecryptable?: boolean
  file?: ChatFile
  recalled?: boolean
  edited?: boolean
  reactions?: MessageReaction[]
  sentAt?: number
  forwarded?: boolean
  like?: boolean
  replyId?: number
  replyToClientId?: string
  voice?: { url: string; duration: number }
  seenBy?: { name: string; readAt: string }[]
  kind?: "call" | "chat"
  call?: {
    type: "voice" | "video"
    dir: "out" | "in"
    duration: number
    outcome:
      | "completed"
      | "missed"
      | "rejected"
      | "cancelled"
      | "no-answer"
      | "ongoing"
      | "unreachable"
      | "busy"
    startedAt?: number
    endedAt?: number
    starterId?: number
    participants?: number
    callId?: string
    groupIds?: number[]
  }
}

export const ROOM_ID_OFFSET = 1_000_000

export interface Conversation {
  id: number
  realId?: number
  name: string
  initials: string
  online: boolean
  lastMessage: string
  time: string
  messages: Message[]
  isGroup?: boolean
  createdBy?: number
  members?: RoomMember[]
  avatar?: string
  theme?: string
  favEmoji?: string
  muted?: boolean
  pinned?: boolean
  approval?: boolean
  nickname?: string
  nicknames?: Record<number, string>
  blocked?: boolean
  bg?: string
  lastAt?: number
  unread?: number
}

export const EMPTY_CONVERSATION: Conversation = {
  id: 0,
  name: "",
  initials: "#",
  online: false,
  lastMessage: "",
  time: "",
  messages: [],
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export type MessageCallData = NonNullable<Message["call"]>

export const formatNowTime = () => {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`
}

export const genClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

