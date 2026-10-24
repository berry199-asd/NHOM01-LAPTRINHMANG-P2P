/**
 * Quy tắc hiển thị TRẠNG THÁI HOẠT ĐỘNG (một nguồn duy nhất cho toàn app).
 *
 * Dữ liệu `online` do server quyết định (`/api/rooms`, `/api/friends`:
 * `registry.isUserOnline(userId, username)` = phiên signaling WS đang mở HOẶC Peer Core
 * còn sống) và được cập nhật thêm theo thời gian thực bằng frame `presence`
 * (Tracker → Peer Core → UI). Giao diện chỉ việc tra theo id thành viên.
 *
 * Vì sao tách hàm: trước đây mỗi chỗ tự suy diễn `members.find(m => m.id !== meId)`
 * bằng `meId` STATE (có lúc còn 0 khi `/api/me` chưa trả về) → chọn nhầm thành viên,
 * nên người ĐANG hoạt động vẫn bị hiện "Ngoại tuyến". Dùng chung hàm dưới đây với id
 * của chính mình đã xác thực để luôn chọn đúng người.
 */

export interface PresenceMember {
  id: number
  online: boolean
}

/** Trạng thái hiển thị của hội thoại: nhóm = có ai khác đang online; 1-1 = trạng thái người kia. */
export function resolvePresence(
  members: ReadonlyArray<PresenceMember> | undefined | null,
  selfId: number,
  isGroup: boolean,
): boolean {
  const list = members ?? []
  const self = Number.isFinite(selfId) && selfId > 0 ? selfId : 0
  // id 0 không phải người dùng hợp lệ: vừa là "chưa biết mình", vừa không thể là người khác.
  const others =
    self > 0 ? list.filter((m) => m.id !== self) : list.filter((m) => m.id !== 0)
  // Không xác định được "mình" → không dám kết luận là offline của người khác.
  if (others.length === 0) return false
  return isGroup ? others.some((m) => m.online) : !!others[0].online
}

/** Nhãn chữ tương ứng (khớp nguyên văn bản đang dùng ở khung chat / bảng hồ sơ). */
export function presenceText(online: boolean): string {
  return online ? "Đang hoạt động" : "Ngoại tuyến"
}

/** Màu nhãn (khớp bảng màu hiện tại: xanh khi online, mờ khi offline). */
export function presenceColor(online: boolean): string {
  return online ? "#22c55e" : "var(--muted)"
}
