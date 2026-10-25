/**
 * Tiện ích chuẩn hoá tiếng Việt: loại bỏ dấu thanh, chuyển về chữ thường
 * để hỗ trợ tìm kiếm không phụ thuộc dấu và bảng mã (NFD/NFC).
 */
export function removeVietnameseTones(str: string): string {
  return (str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
}
