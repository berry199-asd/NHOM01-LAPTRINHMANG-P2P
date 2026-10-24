// Giới hạn thành viên phòng, dùng chung cho modal "Tạo phòng".
// Quy ước: max_members của server tính CẢ người tạo (khớp HttpRestHandler.handleRoomCreate).

/** Số bạn tối đa được chọn khi tạo phòng = giới hạn - 1 (chỗ của người tạo). Tối thiểu 1. */
export function maxSelectableFriends(maxMembers: number): number {
  if (!Number.isFinite(maxMembers)) return 1
  return Math.max(1, Math.floor(maxMembers) - 1)
}

/** Đã chạm trần chọn chưa (đếm cả người tạo). */
export function atRoomMemberLimit(
  selectedCount: number,
  maxMembers: number,
): boolean {
  return selectedCount >= maxSelectableFriends(maxMembers)
}
