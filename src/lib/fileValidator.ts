/**
 * Bộ lọc định dạng tệp, chuẩn hóa tên và kiểm tra magic bytes cho WorkChat.
 * Đảm bảo an toàn tuyệt đối khi gửi/nhận tệp giữa các peer và qua Tracker.
 */

export const ALLOWED_EXTENSIONS = new Set([
  // Ảnh
  "jpg", "jpeg", "png", "gif", "webp",
  // Tài liệu
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "md",
  // Nén
  "zip", "rar", "7z",
  // Âm thanh / Video
  "mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov",
])

export const BLOCKED_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar",
  "apk", "dll", "lnk", "reg", "hta", "svg", "html", "htm", "docm", "xlsm", "pptm",
])

export const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
])

// Ký tự điều khiển Unicode bidi (đảo chiều hiển thị văn bản) và control chars
// U+200E (LRM), U+200F (RLM), U+202A..U+202E (LRE, RLE, PDF, LRO, RLO), U+2066..U+2069 (LRI, RLI, FSI, PDI)
export const DANGEROUS_UNICODE_REGEX =
  /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

export interface SanitizeResult {
  ok: boolean
  name: string
  error?: string
}

/**
 * Chuẩn hóa tên tệp:
 * - Loại bỏ đường dẫn (../, \, /)
 * - Loại bỏ ký tự điều khiển ASCII và ký tự đảo chiều Unicode (bidi override)
 * - Chuẩn hóa Unicode NFC
 * - Bỏ dấu chấm và khoảng trắng ở cuối
 * - Chặn tên dành riêng của Windows (con, nul, com1...)
 * - Giới hạn tối đa 120 ký tự
 */
export function sanitizeFileName(rawName: string): SanitizeResult {
  if (!rawName || typeof rawName !== "string") {
    return { ok: false, name: "file.bin", error: "Tên file không hợp lệ" }
  }

  // 1. Chuẩn hóa NFC
  let s = rawName.normalize("NFC")

  // 2. Loại bỏ đường dẫn (path traversal)
  s = s.replace(/\\/g, "/").split("/").pop() || ""

  // 3. Xóa ký tự điều khiển và bidi
  s = s.replace(DANGEROUS_UNICODE_REGEX, "")

  // 4. Xóa khoảng trắng và dấu chấm ở đầu/cuối
  s = s.trim().replace(/[. ]+$/, "")

  if (!s) {
    return { ok: false, name: "file.bin", error: "Tên file không hợp lệ (trống sau khi làm sạch)" }
  }

  // 5. Kiểm tra tên dành riêng của Windows
  const baseNoExt = s.split(".")[0]?.toLowerCase() || ""
  if (WINDOWS_RESERVED_NAMES.has(baseNoExt)) {
    return { ok: false, name: s, error: `Tên file "${s}" trùng với tên thiết bị dành riêng của hệ thống` }
  }

  // 6. Kiểm tra độ dài tối đa 120 ký tự
  if (s.length > 120) {
    return { ok: false, name: s, error: "Tên file quá dài (tối đa 120 ký tự)" }
  }

  return { ok: true, name: s }
}

export interface ExtensionValidationResult {
  ok: boolean
  error?: string
  ext: string
  category?: "image" | "document" | "archive" | "media"
  warnSender?: boolean
}

/**
 * Kiểm tra phần mở rộng:
 * - Chặn nếu có BẤT KỲ đuôi nào nằm trong danh sách chặn (hỗ trợ chống đuôi kép, vd: anh.jpg.exe)
 * - Yêu cầu phần mở rộng cuối cùng phải nằm trong danh sách cho phép
 */
export function validateFileExtension(fileName: string): ExtensionValidationResult {
  const parts = fileName.toLowerCase().split(".")
  if (parts.length < 2) {
    return { ok: false, error: "File phải có phần mở rộng hợp lệ", ext: "" }
  }

  // Kiểm tra tất cả các phần mở rộng (chống tấn công đuôi kép: file.png.exe, doc.pdf.bat)
  for (let i = 1; i < parts.length; i++) {
    const extPart = parts[i]
    if (BLOCKED_EXTENSIONS.has(extPart)) {
      return {
        ok: false,
        error: `Loại file không được hỗ trợ (.${extPart})`,
        ext: extPart,
      }
    }
  }

  const finalExt = parts[parts.length - 1]
  if (!ALLOWED_EXTENSIONS.has(finalExt)) {
    return {
      ok: false,
      error: `Loại file không được hỗ trợ (.${finalExt})`,
      ext: finalExt,
    }
  }

  let category: "image" | "document" | "archive" | "media" = "document"
  let warnSender = false

  if (["jpg", "jpeg", "png", "gif", "webp"].includes(finalExt)) {
    category = "image"
  } else if (["zip", "rar", "7z"].includes(finalExt)) {
    category = "archive"
    warnSender = true
  } else if (["mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov"].includes(finalExt)) {
    category = "media"
  } else if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(finalExt)) {
    category = "document"
    warnSender = true
  }

  return { ok: true, ext: finalExt, category, warnSender }
}

/**
 * Kiểm tra tính hợp lệ của nội dung file thông qua magic bytes ở đầu tệp.
 * Ngăn chặn giả mạo đuôi (ví dụ: đổi đuôi .exe thành .png).
 */
export function inspectMagicBytes(
  header: Uint8Array,
  fileName: string,
): { ok: boolean; error?: string } {
  if (!header || header.length === 0) {
    return { ok: false, error: "File rỗng (0 byte)" }
  }

  // 1. Chặn ngay nếu phát hiện signature chương trình thực thi PE (EXE/DLL)
  if (header.length >= 2 && header[0] === 0x4D && header[1] === 0x5A) {
    return { ok: false, error: "Nội dung file là chương trình thực thi (.exe)" }
  }

  // 2. Chặn ELF executable (Linux binary)
  if (header.length >= 4 && header[0] === 0x7F && header[1] === 0x45 && header[2] === 0x4C && header[3] === 0x46) {
    return { ok: false, error: "Nội dung file là mã thực thi nhị phân" }
  }

  const ext = fileName.toLowerCase().split(".").pop() || ""

  // 3. Kiểm tra ảnh JPEG
  if (ext === "jpg" || ext === "jpeg") {
    if (header.length < 3 || header[0] !== 0xFF || header[1] !== 0xD8 || header[2] !== 0xFF) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .jpg" }
    }
    return { ok: true }
  }

  // 4. Kiểm tra ảnh PNG
  if (ext === "png") {
    if (
      header.length < 8 ||
      header[0] !== 0x89 ||
      header[1] !== 0x50 ||
      header[2] !== 0x4E ||
      header[3] !== 0x47 ||
      header[4] !== 0x0D ||
      header[5] !== 0x0A ||
      header[6] !== 0x1A ||
      header[7] !== 0x0A
    ) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .png" }
    }
    return { ok: true }
  }

  // 5. Kiểm tra ảnh GIF
  if (ext === "gif") {
    if (
      header.length < 6 ||
      header[0] !== 0x47 ||
      header[1] !== 0x49 ||
      header[2] !== 0x46 ||
      header[3] !== 0x38 ||
      (header[4] !== 0x37 && header[4] !== 0x39) ||
      header[5] !== 0x61
    ) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .gif" }
    }
    return { ok: true }
  }

  // 6. Kiểm tra ảnh WebP (RIFF....WEBP)
  if (ext === "webp") {
    if (
      header.length < 12 ||
      header[0] !== 0x52 || header[1] !== 0x49 || header[2] !== 0x46 || header[3] !== 0x46 ||
      header[8] !== 0x57 || header[9] !== 0x45 || header[10] !== 0x42 || header[11] !== 0x50
    ) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .webp" }
    }
    return { ok: true }
  }

  // 7. Kiểm tra PDF (%PDF)
  if (ext === "pdf") {
    if (
      header.length < 4 ||
      header[0] !== 0x25 ||
      header[1] !== 0x50 ||
      header[2] !== 0x44 ||
      header[3] !== 0x46
    ) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .pdf" }
    }
    return { ok: true }
  }

  // 8. Kiểm tra ZIP và Office hiện đại (docx, xlsx, pptx có header PK\x03\x04)
  if (["zip", "docx", "xlsx", "pptx"].includes(ext)) {
    if (
      header.length < 4 ||
      header[0] !== 0x50 ||
      header[1] !== 0x4B ||
      header[2] !== 0x03 ||
      header[3] !== 0x04
    ) {
      return { ok: false, error: `Nội dung file không khớp với đuôi .${ext}` }
    }
    return { ok: true }
  }

  // 9. Kiểm tra Office cũ (doc, xls, ppt là OLE2 compound file: D0 CF 11 E0 A1 B1 1A E1)
  if (["doc", "xls", "ppt"].includes(ext)) {
    if (
      header.length < 8 ||
      header[0] !== 0xD0 ||
      header[1] !== 0xCF ||
      header[2] !== 0x11 ||
      header[3] !== 0xE0 ||
      header[4] !== 0xA1 ||
      header[5] !== 0xB1 ||
      header[6] !== 0x1A ||
      header[7] !== 0xE1
    ) {
      return { ok: false, error: `Nội dung file không khớp với đuôi .${ext}` }
    }
    return { ok: true }
  }

  // 10. Kiểm tra 7z (37 7A BC AF 27 1C)
  if (ext === "7z") {
    if (
      header.length < 6 ||
      header[0] !== 0x37 || header[1] !== 0x7A || header[2] !== 0xBC ||
      header[3] !== 0xAF || header[4] !== 0x27 || header[5] !== 0x1C
    ) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .7z" }
    }
    return { ok: true }
  }

  // 11. Kiểm tra RAR (52 61 72 21 1A 07)
  if (ext === "rar") {
    if (
      header.length < 6 ||
      header[0] !== 0x52 || header[1] !== 0x61 || header[2] !== 0x72 ||
      header[3] !== 0x21 || header[4] !== 0x1A || header[5] !== 0x07
    ) {
      return { ok: false, error: "Nội dung file không khớp với đuôi .rar" }
    }
    return { ok: true }
  }

  return { ok: true }
}
