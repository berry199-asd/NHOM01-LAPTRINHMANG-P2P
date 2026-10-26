// Gốc API. Ưu tiên `VITE_API_URL` khi được cấu hình; nếu TRỐNG thì gọi CÙNG ORIGIN
// với trang (đường dẫn tương đối) để đi qua proxy `/api` của Vite. Nhờ vậy API và
// mọi tài nguyên (ảnh đại diện...) luôn tải qua đúng host/cổng đang mở trang —
// không hardcode `localhost:9090` (sai khi mở qua IP/LAN hoặc từ máy khác, gây lỗi
// tải ảnh → rơi về chữ viết tắt) và không vướng mixed content khi web chạy HTTPS.
const API_BASE =
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? ""
const TOKEN_KEY = "workchat_token"
const ADMIN_TOKEN_KEY = "workchat_admin_token"

import type { RoomSettings, JoinRequest, RoomBlock } from "../types/chat"

export interface ApiUser {
  id: number
  username: string
  public_id?: string
  profile_url?: string
  email: string
  display_name: string
  role: string
  email_verified: boolean
  bio?: string
  phone?: string
  birthdate?: string
  joined?: string
  phone_public?: boolean
  avatar?: string
  cover?: string
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

interface RegisterBody {
  username?: string
  email: string
  password: string
  display_name: string
  date_of_birth?: string
}

interface LoginBody {
  username: string
  password: string
}

interface OtpBody {
  email: string
  code: string
  purpose: "register" | "forgot_password"
}

interface ResetBody {
  email: string
  code: string
  new_password: string
}

interface ChangePasswordBody {
  current_password: string
  new_password: string
}

interface UpdateProfileBody {
  display_name?: string
  bio?: string
  phone?: string
  date_of_birth?: string
  phone_public?: boolean
  avatar?: string
  cover?: string
}

interface ChangeEmailRequestBody {
  new_email: string
  current_password: string
}

interface ChangeEmailConfirmBody {
  new_email: string
  code_old: string
  code_new: string
}

interface LoginData {
  token: string
  user: ApiUser
}

export interface ApiDirectoryUser {
  id: number
  public_id: string
  display_name: string
  avatar: string
  relation?: string
  request_id?: number
}

export type Relation = "none" | "pending_sent" | "pending_received" | "friend" | "self"

export interface ApiPublicUser {
  id?: number
  public_id?: string
  display_name: string
  avatar: string
  cover?: string
  bio?: string
  created_at?: number
  online?: boolean
  last_seen_at?: number
  relation: Relation
  request_id?: number
  username?: string
}

export interface ApiFriendRequestItem {
  request_id: number
  from: {
    public_id: string
    display_name: string
    avatar: string
    username?: string
  }
  created_at: number
  created_by?: number
}

export interface ApiSentRequestItem {
  request_id: number
  to: {
    id?: number
    public_id: string
    display_name: string
    avatar: string
    username?: string
  }
  created_at: number
}

export interface ApiFriendSuggestionItem {
  id: number
  public_id: string
  username: string
  display_name: string
  avatar: string
  mutual_count: number
  shared_rooms: number
}

export interface ApiRoomMember {
  id: number
  public_id?: string
  username: string
  display_name: string
  avatar: string
  role: "member" | "leader" | "owner" | "admin"
  online: boolean
  last_seen_at?: number
  last_read_message_id: string
}

export interface ApiRoom {
  id: number
  is_direct: boolean
  name: string
  avatar: string
  background?: string
  theme_color: string
  default_reaction_emoji?: string
  created_at: number
  created_by?: number
  last_at: number
  members: ApiRoomMember[]
  settings?: RoomSettings
  pending_join_requests_count?: number
}

interface CreateRoomBody {
  name?: string
  avatar?: string
  member_ids: number[]
}

export interface ApiReaction {
  user_id: number
  emoji: string
  name: string
  username: string
  initials: string
  mine: boolean
}

export interface ApiReactionSeenBy {
  user_id: number
  name: string
  username: string
  initials: string
}

export interface ApiMessage {
  id: number
  client_msg_id: string
  room_id: number
  sender_id: number
  sender_username: string
  sender_name: string
  sender_avatar: string
  type: string
  content: string
  reply_to_client_id: string
  forwarded_from_client_id?: string
  is_edited: boolean
  is_recalled_all: boolean
  sent_at: number
  edited_at: number
  reactions?: ApiReaction[]
  seen_by?: ApiReactionSeenBy[]
}

export interface SendMessageBody {
  client_msg_id: string
  /** Bỏ trống/để rỗng = tin E2E: server chỉ lưu metadata (content NULL). */
  text?: string
  reply_to_client_id?: string
  type?: string
}

export interface ApiAdminUser {
  id: number
  username: string
  email: string
  display_name: string
  role: string
  locked: boolean
  email_verified: boolean
  last_seen_at: number
}

export interface ApiAdminPeer {
  id: number
  username: string
  display_name: string
  email: string
  online_since: number
  online_secs: number
  connection: string
}

export interface ApiAdminLog {
  id: number
  type: string
  user_id: number | null
  account: string
  ip: string | null
  detail: string | null
  at: number | null
}

export interface ApiAdminOverview {
  total_users: number
  online_peers: number
  sessions: number
  p2p_peers: number
  pending_reports: number
}

export interface ApiAdminConfig {
  key: string
  value: string | null
}

export interface ApiAdminReport {
  id: number
  reporter_id: number
  reporter: string | null
  target_type: string
  target_id: string
  reason: string
  evidence_note: string | null
  status: string
  handled_by: number | null
  handled_at: number | null
  created_at: number | null
}

export interface ApiAdminBroadcast {
  id: number
  title: string
  content: string
  sent_by: number | null
  sender: string | null
  sent_at: number | null
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  let res: Response | null = null
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    })
  } catch {
    return { ok: false, status: 0, data: null, error: "network" }
  }
  let payload: { error?: string } | null = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: payload?.error ?? `http_${res.status}`,
    }
  }
  return {
    ok: true,
    status: res.status,
    data: (payload ?? {}) as T,
    error: null,
  }
}

// Token phiên đăng nhập lưu trong sessionStorage: mỗi tab một phiên riêng,
// F5 giữ phiên, đóng tab là đăng xuất. Admin dùng key tách biệt để không ghi
// đè token người dùng trong cùng tab.
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

export function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY)
}

export function setAdminToken(token: string) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token)
}

export function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY)
}

function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) })
}

async function getWithAuth<T>(path: string): Promise<ApiResult<T>> {
  const token = getToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, { headers: { Authorization: `Bearer ${token}` } })
}

async function postWithAuth<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const token = getToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function postPathWithAuth<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  const token = getToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function delWithAuth<T>(path: string): Promise<ApiResult<T>> {
  const token = getToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
}

async function adminGet<T>(path: string): Promise<ApiResult<T>> {
  const token = getAdminToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, { headers: { Authorization: `Bearer ${token}` } })
}

async function adminPostPath<T>(path: string): Promise<ApiResult<T>> {
  const token = getAdminToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function adminPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const token = getAdminToken()
  if (!token) return { ok: false, status: 401, data: null, error: "missing_token" }
  return request<T>(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export const api = {
  register: (body: RegisterBody) =>
    post<{ ok: boolean; otp_sent?: boolean }>("/api/register", body),
  login: (body: LoginBody) => post<LoginData>("/api/login", body),
  logout: () => postPathWithAuth<{ ok: boolean }>("/api/logout"),
  peerTicket: (nonce: string) =>
    postPathWithAuth<{ ticket: string; expires_in: number }>("/api/peer/ticket", { nonce }),
  verifyOtp: (body: OtpBody) =>
    post<{ ok: boolean; purpose: string }>("/api/verify-otp", body),
  resendOtp: (email: string) =>
    post<{ ok: boolean; otp_sent?: boolean }>("/api/resend-otp", { email }),
  forgotPassword: (email: string) =>
    post<{ ok: boolean; otp_sent?: boolean }>("/api/forgot-password", { email }),
  resetPassword: (body: ResetBody) =>
    post<{ ok: boolean }>("/api/reset-password", body),
  me: () => getWithAuth<{ user: ApiUser }>("/api/me"),
  publicConfig: () =>
    request<{
      max_room_members: number
      max_image_mb?: number
      max_file_mb_direct?: number
      max_file_mb_blob?: number
      max_files_per_message?: number
      user_blob_quota_mb?: number
      blob_ttl_days?: number
    }>("/api/config/public"),
  roomsList: () => getWithAuth<{ rooms: ApiRoom[] }>("/api/rooms"),
  roomDetail: (id: number) =>
    getWithAuth<{ room: ApiRoom }>(`/api/rooms/${id}`),
  roomMessages: (id: number, opts?: { before?: number; limit?: number }) => {
    const q = new URLSearchParams()
    if (opts?.before !== undefined) q.set("before", String(opts.before))
    if (opts?.limit !== undefined) q.set("limit", String(opts.limit))
    const qs = q.toString()
    return getWithAuth<{ messages: ApiMessage[]; has_more: boolean }>(
      `/api/rooms/${id}/messages${qs ? `?${qs}` : ""}`,
    )
  },
  sendMessage: (id: number, body: SendMessageBody) =>
    postWithAuth<{ message: ApiMessage; duplicate: boolean }>(
      `/api/rooms/${id}/messages`,
      body,
    ),
  roomCreate: (body: CreateRoomBody) =>
    postWithAuth<{ ok: boolean; room: ApiRoom }>("/api/rooms", body),
  openDirectRoom: (userId: number) =>
    postWithAuth<{ ok: boolean; room: ApiRoom }>("/api/rooms/direct", {
      user_id: userId,
    }),
  changePassword: (body: ChangePasswordBody) =>
    postWithAuth<{ ok: boolean }>("/api/change-password", body),
  updateProfile: (body: UpdateProfileBody) =>
    postWithAuth<{ ok: boolean; user?: ApiUser }>("/api/update-profile", body),
  changeEmailRequest: (body: ChangeEmailRequestBody) =>
    postWithAuth<{ ok: boolean; otp_sent?: boolean }>(
      "/api/change-email/request",
      body,
    ),
  changeEmailConfirm: (body: ChangeEmailConfirmBody) =>
    postWithAuth<{ ok: boolean; user?: ApiUser }>(
      "/api/change-email/confirm",
      body,
    ),
  userByPublicId: (publicId: string) =>
    getWithAuth<{ user: ApiPublicUser }>(
      `/api/users/by-public-id/${encodeURIComponent(publicId)}`,
    ),
  searchUser: async (q: string) => {
    const raw = q.trim()
    if (!raw) return { ok: true, data: { users: [] as ApiPublicUser[] } }
    try {
      const res = await getWithAuth<{ users: ApiPublicUser[] }>(
        `/api/users/search?q=${encodeURIComponent(raw)}`,
      )
      if (res.ok && res.data?.users) {
        return res
      }
    } catch {
      // Bỏ qua, thử fallback bên dưới
    }
    const cleanId = raw.replace(/^\/?[uU]\//, "").replace(/^@/, "").trim()
    if (cleanId) {
      const userRes = await getWithAuth<{ user: ApiPublicUser }>(
        `/api/users/by-public-id/${encodeURIComponent(cleanId)}`,
      )
      if (userRes.ok && userRes.data?.user) {
        return { ok: true, data: { users: [userRes.data.user] } }
      }
    }
    return { ok: true, data: { users: [] as ApiPublicUser[] } }
  },
  friendsList: () => getWithAuth<{ friends: ApiPublicUser[] }>("/api/friends"),
  friendRequests: () =>
    getWithAuth<{ requests: ApiFriendRequestItem[] }>("/api/friends/requests"),
  requestFriend: (publicId: string) =>
    postWithAuth<{
      ok: boolean
      outcome?: string
      request_id?: number
      room?: ApiRoom
      friend?: ApiPublicUser
    }>("/api/friends/request", { public_id: publicId }),
  acceptFriend: (requestId: number) =>
    postPathWithAuth<{
      ok: boolean
      outcome?: string
      room?: ApiRoom
      friend?: ApiPublicUser
    }>(`/api/friends/${requestId}/accept`),
  rejectFriend: (requestId: number) =>
    postPathWithAuth<{ ok: boolean; outcome?: string }>(
      `/api/friends/${requestId}/reject`,
    ),
  cancelFriend: (requestId: number) =>
    postPathWithAuth<{ ok: boolean; outcome?: string }>(
      `/api/friends/${requestId}/cancel`,
    ),
  friendSentList: () =>
    getWithAuth<{ requests: ApiSentRequestItem[] }>("/api/friends/sent"),
  friendSuggestions: () =>
    getWithAuth<{ suggestions: ApiFriendSuggestionItem[] }>(
      "/api/friends/suggestions",
    ),
  unfriend: (userIdOrPublicId: number | string) =>
    postPathWithAuth<{ ok: boolean; unfriended?: boolean }>(
      `/api/friends/${encodeURIComponent(String(userIdOrPublicId))}/unfriend`,
    ),
  roomInvite: (roomId: number, ttlDays?: number) =>
    postWithAuth<{ ok: boolean; code: string; room_id: number }>(
      "/api/rooms/invite",
      { room_id: roomId, ttl_days: ttlDays },
    ),
  joinRoom: (code: string) =>
    postWithAuth<{ ok: boolean; already_member?: boolean; room: ApiRoom }>(
      "/api/rooms/join",
      { code },
    ),
  roomMemberAdd: (roomId: number, userId: number) =>
    postWithAuth<{ ok: boolean; already_member?: boolean; room: ApiRoom }>(
      `/api/rooms/${roomId}/member/add`,
      { user_id: userId },
    ),
  roomUpdate: (
    roomId: number,
    body: {
      name?: string
      avatar?: string
      theme?: string
      emoji?: string
      bg?: string
    },
  ) =>
    postWithAuth<{ ok: boolean; room: ApiRoom }>(`/api/rooms/${roomId}`, body),
  roomMemberRole: (roomId: number, userId: number, role: "leader" | "member") =>
    postWithAuth<{ ok: boolean; room?: ApiRoom }>(`/api/rooms/${roomId}/member/role`, {
      user_id: userId,
      role,
    }),
  roomMemberRemove: (roomId: number, userId: number) =>
    postWithAuth<{ ok: boolean }>(`/api/rooms/${roomId}/member/remove`, {
      user_id: userId,
    }),
  roomLeave: (roomId: number) =>
    postWithAuth<{ ok: boolean }>(`/api/rooms/${roomId}/leave`, {}),
  updateRoomSettings: (roomId: number, settings: Partial<RoomSettings>) =>
    postWithAuth<{ ok: boolean; settings: RoomSettings }>(
      `/api/rooms/${roomId}/settings`,
      settings,
    ),
  regenerateRoomJoinToken: (roomId: number) =>
    postWithAuth<{ ok: boolean; token: string }>(
      `/api/rooms/${roomId}/settings`,
      { action: "regenerate_link" },
    ),
  setRoomMemberRole: (
    roomId: number,
    userId: number,
    role: "owner" | "admin" | "member" | "leader",
  ) =>
    postWithAuth<{ ok: boolean; room?: ApiRoom }>(
      `/api/rooms/${roomId}/members/${userId}/role`,
      { role },
    ),
  transferRoomOwner: (roomId: number, newOwnerId: number) =>
    postWithAuth<{ ok: boolean; room?: ApiRoom }>(
      `/api/rooms/${roomId}/transfer-owner`,
      { new_owner_id: newOwnerId },
    ),
  dissolveRoom: (roomId: number) =>
    postWithAuth<{ ok: boolean }>(`/api/rooms/${roomId}/dissolve`, {}),
  removeRoomMember: (roomId: number, userId: number) =>
    delWithAuth<{ ok: boolean }>(`/api/rooms/${roomId}/members/${userId}`),
  getRoomBlocks: (roomId: number) =>
    getWithAuth<{ ok: boolean; blocks: RoomBlock[] }>(
      `/api/rooms/${roomId}/blocks`,
    ),
  blockRoomMember: (roomId: number, userId: number, reason?: string) =>
    postWithAuth<{ ok: boolean }>(`/api/rooms/${roomId}/blocks/${userId}`, {
      reason,
    }),
  unblockRoomMember: (roomId: number, userId: number) =>
    delWithAuth<{ ok: boolean }>(`/api/rooms/${roomId}/blocks/${userId}`),
  getRoomJoinRequests: (roomId: number) =>
    getWithAuth<{ ok: boolean; requests: JoinRequest[] }>(
      `/api/rooms/${roomId}/join-requests`,
    ),
  decideRoomJoinRequest: (
    roomId: number,
    requestId: number,
    action: "approve" | "reject",
  ) =>
    postWithAuth<{
      ok: boolean
      status?: string
      already_decided?: boolean
      decided_by?: number
    }>(`/api/rooms/${roomId}/join-requests/${requestId}/${action}`, {}),
  approveAllRoomJoinRequests: (roomId: number) =>
    postWithAuth<{ ok: boolean; approved_count: number }>(
      `/api/rooms/${roomId}/join-requests/approve-all`,
      {},
    ),
  editMessage: (roomId: number, clientMsgId: string) =>
    postPathWithAuth<{ message: ApiMessage }>(
      `/api/rooms/${roomId}/messages/${encodeURIComponent(clientMsgId)}/edit`,
    ),
  recallMessage: (roomId: number, clientMsgId: string) =>
    postPathWithAuth<{ message: ApiMessage }>(
      `/api/rooms/${roomId}/messages/${encodeURIComponent(clientMsgId)}/recall`,
    ),
  deleteMessageForMe: (roomId: number, clientMsgId: string) =>
    delWithAuth<{ ok: boolean }>(
      `/api/rooms/${roomId}/messages/${encodeURIComponent(clientMsgId)}`,
    ),
  setReaction: (roomId: number, clientMsgId: string, emoji: string) =>
    postWithAuth<{ message: ApiMessage }>(
      `/api/rooms/${roomId}/messages/${encodeURIComponent(clientMsgId)}/reaction`,
      { emoji },
    ),
  removeReaction: (roomId: number, clientMsgId: string) =>
    delWithAuth<{ message: ApiMessage }>(
      `/api/rooms/${roomId}/messages/${encodeURIComponent(clientMsgId)}/reaction`,
    ),
  markRoomRead: (roomId: number, clientMsgId: string) =>
    postWithAuth<{ ok: boolean; last_read_message_id: string }>(
      `/api/rooms/${roomId}/read`,
      { client_msg_id: clientMsgId },
    ),
  forwardMessage: (
    roomId: number,
    body: { client_msg_id: string; forwarded_from_client_id: string; type?: string },
  ) =>
    postWithAuth<{ message: ApiMessage }>(
      `/api/rooms/${roomId}/messages/forward`,
      body,
    ),
  adminUsers: (q: string) =>
    adminGet<{ users: ApiAdminUser[] }>(
      `/api/admin/users?q=${encodeURIComponent(q || "")}&limit=200`,
    ),
  adminSetLocked: (id: number, lock: boolean) =>
    adminPostPath<{ ok: boolean; locked: boolean }>(
      `/api/admin/users/${id}/${lock ? "lock" : "unlock"}`,
    ),
  adminPeers: () =>
    adminGet<{ peers: ApiAdminPeer[]; count: number }>("/api/admin/peers"),
  adminLogs: (type: string, limit = 200) =>
    adminGet<{ logs: ApiAdminLog[] }>(
      `/api/admin/logs?type=${encodeURIComponent(type)}&limit=${limit}`,
    ),
  adminSetRole: (id: number, role: string) =>
    adminPost<{ ok: boolean; role: string }>(`/api/admin/users/${id}/role`, { role }),
  adminOverview: () =>
    adminGet<ApiAdminOverview>("/api/admin/overview"),
  adminConfig: () =>
    adminGet<{ config: ApiAdminConfig[] }>("/api/admin/config"),
  adminSetConfig: (key: string, value: string) =>
    adminPost<{ ok: boolean; key: string; value: string }>("/api/admin/config", {
      key,
      value,
    }),
  adminReports: (status = "all", limit = 200) =>
    adminGet<{ reports: ApiAdminReport[] }>(
      `/api/admin/reports?status=${encodeURIComponent(status)}&limit=${limit}`,
    ),
  adminReportStatus: (id: number, status: string) =>
    adminPost<{ ok: boolean; status: string }>(`/api/admin/reports/${id}/status`, {
      status,
    }),
  adminBroadcasts: (limit = 50) =>
    adminGet<{ broadcasts: ApiAdminBroadcast[] }>(
      `/api/admin/broadcasts?limit=${limit}`,
    ),
  adminSendBroadcast: (title: string, content: string) =>
    adminPost<{ ok: boolean; id: number; reached: number }>("/api/admin/broadcasts", {
      title,
      content,
    }),
  e2eOtpRequest: (email: string) =>
    postWithAuth<{ ok: boolean; error?: string }>("/api/e2e/otp/request", { email }),
  e2eOtpVerify: (email: string, otp: string) =>
    postWithAuth<{ ok: boolean; ticket?: string; error?: string }>("/api/e2e/otp/verify", { email, otp }),
  createReport: (data: {
    target_type: "user" | "room" | "message"
    target_id: string
    reason?: string
    evidence_note?: string
  }) =>
    postWithAuth<{ ok: boolean; id?: number; error?: string }>("/api/reports", data),
}

export type { ApiUser as User }