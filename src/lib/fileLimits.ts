/**
 * Cấu hình giới hạn kích thước và số lượng tệp truyền trong WorkChat.
 * Nguồn cấu hình duy nhất từ Tracker (system_config), đồng bộ về giao diện và Peer Core.
 */

export interface FileLimits {
  maxImageMb: number
  maxFileMbDirect: number
  maxFileMbBlob: number
  maxFilesPerMessage: number
  userBlobQuotaMb: number
  blobTtlDays: number
}

export const DEFAULT_FILE_LIMITS: FileLimits = {
  maxImageMb: 10,
  maxFileMbDirect: 25,
  maxFileMbBlob: 10,
  maxFilesPerMessage: 5,
  userBlobQuotaMb: 200,
  blobTtlDays: 7,
}

let cachedLimits: FileLimits = { ...DEFAULT_FILE_LIMITS }

export function clampLimit(key: keyof FileLimits, val: number): number {
  switch (key) {
    case "maxImageMb":
      return Math.max(1, Math.min(50, val))
    case "maxFileMbDirect":
      return Math.max(1, Math.min(100, val))
    case "maxFileMbBlob":
      return Math.max(1, Math.min(50, val))
    case "maxFilesPerMessage":
      return Math.max(1, Math.min(20, val))
    case "userBlobQuotaMb":
      return Math.max(10, Math.min(2048, val))
    case "blobTtlDays":
      return Math.max(1, Math.min(30, val))
    default:
      return val
  }
}

export function parseFileLimits(raw: Record<string, unknown> | null | undefined): FileLimits {
  if (!raw) return { ...DEFAULT_FILE_LIMITS }
  return {
    maxImageMb: clampLimit("maxImageMb", Number(raw.max_image_mb ?? DEFAULT_FILE_LIMITS.maxImageMb)),
    maxFileMbDirect: clampLimit("maxFileMbDirect", Number(raw.max_file_mb_direct ?? DEFAULT_FILE_LIMITS.maxFileMbDirect)),
    maxFileMbBlob: clampLimit("maxFileMbBlob", Number(raw.max_file_mb_blob ?? DEFAULT_FILE_LIMITS.maxFileMbBlob)),
    maxFilesPerMessage: clampLimit("maxFilesPerMessage", Number(raw.max_files_per_message ?? DEFAULT_FILE_LIMITS.maxFilesPerMessage)),
    userBlobQuotaMb: clampLimit("userBlobQuotaMb", Number(raw.user_blob_quota_mb ?? DEFAULT_FILE_LIMITS.userBlobQuotaMb)),
    blobTtlDays: clampLimit("blobTtlDays", Number(raw.blob_ttl_days ?? DEFAULT_FILE_LIMITS.blobTtlDays)),
  }
}

export function setFileLimits(limits: Partial<FileLimits>): FileLimits {
  cachedLimits = {
    ...cachedLimits,
    ...limits,
  }
  return cachedLimits
}

export function getFileLimits(): FileLimits {
  return cachedLimits
}

export interface SizeValidationResult {
  ok: boolean
  error?: string
  maxBytes: number
  limitMb: number
}

/**
 * Kiểm tra kích thước tệp dựa trên loại phòng (nhóm luôn dùng giới hạn blob) và đường truyền.
 */
export function validateFileSize(
  bytes: number,
  isGroup: boolean,
  isDirectPossible = true,
  limits: FileLimits = getFileLimits(),
): SizeValidationResult {
  if (bytes <= 0) {
    return {
      ok: false,
      error: "File rỗng (0 byte)",
      maxBytes: 0,
      limitMb: 0,
    }
  }

  // Phòng nhóm luôn đi qua Tracker blob
  if (isGroup) {
    const maxMb = limits.maxFileMbBlob
    const maxBytes = maxMb * 1024 * 1024
    if (bytes > maxBytes) {
      return {
        ok: false,
        error: `File quá lớn (tối đa ${maxMb} MB cho phòng nhóm)`,
        maxBytes,
        limitMb: maxMb,
      }
    }
    return { ok: true, maxBytes, limitMb: maxMb }
  }

  // Cuộc trò chuyện 1-1
  const maxMb = isDirectPossible ? limits.maxFileMbDirect : limits.maxFileMbBlob
  const maxBytes = maxMb * 1024 * 1024
  if (bytes > maxBytes) {
    return {
      ok: false,
      error: `File quá lớn (tối đa ${maxMb} MB)`,
      maxBytes,
      limitMb: maxMb,
    }
  }
  return { ok: true, maxBytes, limitMb: maxMb }
}

export function validateImageSize(
  bytes: number,
  limits: FileLimits = getFileLimits(),
): { ok: boolean; error?: string; maxBytes: number; limitMb: number } {
  const maxMb = limits.maxImageMb
  const maxBytes = maxMb * 1024 * 1024
  if (bytes <= 0) {
    return { ok: false, error: "Ảnh rỗng (0 byte)", maxBytes: 0, limitMb: 0 }
  }
  if (bytes > maxBytes) {
    return {
      ok: false,
      error: `Ảnh vượt quá dung lượng cho phép (tối đa ${maxMb} MB)`,
      maxBytes,
      limitMb: maxMb,
    }
  }
  return { ok: true, maxBytes, limitMb: maxMb }
}

export function validateFileCount(
  count: number,
  limits: FileLimits = getFileLimits(),
): { ok: boolean; error?: string } {
  if (count <= 0) {
    return { ok: false, error: "Không có file nào được chọn" }
  }
  if (count > limits.maxFilesPerMessage) {
    return {
      ok: false,
      error: `Chỉ được gửi tối đa ${limits.maxFilesPerMessage} file mỗi lần`,
    }
  }
  return { ok: true }
}
