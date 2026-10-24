package com.workchat.peer;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Kiểm tra an ninh tệp độc lập phía máy chủ Peer Core.
 * Thẩm quyền kiểm tra đuôi cho phép, đuôi cấm (kể cả đuôi kép), tên tệp độc hại và magic bytes.
 */
public final class FileSecurity {

    private FileSecurity() {
    }

    public static final Set<String> ALLOWED_EXTS = Set.of(
            // Ảnh
            "jpg", "jpeg", "png", "gif", "webp",
            // Tài liệu
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf", "md",
            // Nén
            "zip", "rar", "7z",
            // Âm thanh / Video
            "mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov"
    );

    public static final Set<String> BLOCKED_EXTS = Set.of(
            "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "jar",
            "apk", "dll", "lnk", "reg", "hta", "svg", "html", "htm", "docm", "xlsm", "pptm"
    );

    public static final Set<String> WINDOWS_RESERVED = Set.of(
            "con", "prn", "aux", "nul",
            "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
            "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
    );

    private static final Pattern DANGEROUS_CHARS =
            Pattern.compile("[\\u0000-\\u001F\\u007F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]");

    public record NameCheck(boolean ok, String name, String error) {
    }

    /**
     * Chuẩn hóa và làm sạch tên file.
     */
    public static NameCheck sanitizeName(String raw) {
        if (raw == null || raw.isBlank()) {
            return new NameCheck(false, "file.bin", "Tên file không hợp lệ");
        }
        // NFC normalization
        String s = Normalizer.normalize(raw, Normalizer.Form.NFC);
        // Loại bỏ path traversal
        s = s.replace('\\', '/');
        int slash = s.lastIndexOf('/');
        if (slash >= 0) {
            s = s.substring(slash + 1);
        }
        // Xóa ký tự điều khiển và bidi
        s = DANGEROUS_CHARS.matcher(s).replaceAll("");
        // Xóa dấu chấm và khoảng trắng cuối
        s = s.strip();
        while (s.endsWith(".") || s.endsWith(" ")) {
            s = s.substring(0, s.length() - 1);
        }
        if (s.isBlank()) {
            return new NameCheck(false, "file.bin", "Tên file không hợp lệ (trống sau khi làm sạch)");
        }
        // Kiểm tra tên Windows dành riêng
        String base = s.split("\\.")[0].toLowerCase(Locale.ROOT);
        if (WINDOWS_RESERVED.contains(base)) {
            return new NameCheck(false, s, "Tên file trùng với tên thiết bị dành riêng của hệ thống");
        }
        if (s.length() > 120) {
            return new NameCheck(false, s, "Tên file quá dài (tối đa 120 ký tự)");
        }
        return new NameCheck(true, s, null);
    }

    public record ExtCheck(boolean ok, String ext, String error) {
    }

    /**
     * Kiểm tra phần mở rộng tệp và chống tấn công đuôi kép.
     */
    public static ExtCheck validateExtension(String name) {
        if (name == null) {
            return new ExtCheck(false, "", "Tên file không hợp lệ");
        }
        String[] parts = name.toLowerCase(Locale.ROOT).split("\\.");
        if (parts.length < 2) {
            return new ExtCheck(false, "", "File phải có phần mở rộng");
        }
        for (int i = 1; i < parts.length; i++) {
            if (BLOCKED_EXTS.contains(parts[i])) {
                return new ExtCheck(false, parts[i], "Loại file không được hỗ trợ (." + parts[i] + ")");
            }
        }
        String finalExt = parts[parts.length - 1];
        if (!ALLOWED_EXTS.contains(finalExt)) {
            return new ExtCheck(false, finalExt, "Loại file không được hỗ trợ (." + finalExt + ")");
        }
        return new ExtCheck(true, finalExt, null);
    }

    public record MagicCheck(boolean ok, String error) {
    }

    /**
     * Kiểm tra magic bytes ở đầu tệp nhị phân.
     */
    public static MagicCheck inspectMagicBytes(byte[] header, String name) {
        if (header == null || header.length == 0) {
            return new MagicCheck(false, "File rỗng (0 byte)");
        }
        // Chặn EXE/DLL (MZ)
        if (header.length >= 2 && (header[0] & 0xFF) == 0x4D && (header[1] & 0xFF) == 0x5A) {
            return new MagicCheck(false, "Nội dung file là chương trình thực thi (.exe)");
        }
        // Chặn ELF
        if (header.length >= 4 && (header[0] & 0xFF) == 0x7F && header[1] == 'E' && header[2] == 'L' && header[3] == 'F') {
            return new MagicCheck(false, "Nội dung file là mã thực thi nhị phân");
        }

        String ext = name.toLowerCase(Locale.ROOT);
        int dot = ext.lastIndexOf('.');
        if (dot >= 0) {
            ext = ext.substring(dot + 1);
        }

        if ("jpg".equals(ext) || "jpeg".equals(ext)) {
            if (header.length < 3 || (header[0] & 0xFF) != 0xFF || (header[1] & 0xFF) != 0xD8 || (header[2] & 0xFF) != 0xFF) {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi .jpg");
            }
            return new MagicCheck(true, null);
        }
        if ("png".equals(ext)) {
            if (header.length < 8 || (header[0] & 0xFF) != 0x89 || header[1] != 'P' || header[2] != 'N' || header[3] != 'G'
                    || header[4] != 0x0D || header[5] != 0x0A || header[6] != 0x1A || header[7] != 0x0A) {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi .png");
            }
            return new MagicCheck(true, null);
        }
        if ("gif".equals(ext)) {
            if (header.length < 6 || header[0] != 'G' || header[1] != 'I' || header[2] != 'F' || header[3] != '8') {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi .gif");
            }
            return new MagicCheck(true, null);
        }
        if ("pdf".equals(ext)) {
            if (header.length < 4 || header[0] != '%' || header[1] != 'P' || header[2] != 'D' || header[3] != 'F') {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi .pdf");
            }
            return new MagicCheck(true, null);
        }
        if ("zip".equals(ext) || "docx".equals(ext) || "xlsx".equals(ext) || "pptx".equals(ext)) {
            if (header.length < 4 || header[0] != 'P' || header[1] != 'K' || (header[2] & 0xFF) != 0x03 || (header[3] & 0xFF) != 0x04) {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi ." + ext);
            }
            return new MagicCheck(true, null);
        }
        if ("doc".equals(ext) || "xls".equals(ext) || "ppt".equals(ext)) {
            if (header.length < 8 || (header[0] & 0xFF) != 0xD0 || (header[1] & 0xFF) != 0xCF
                    || (header[2] & 0xFF) != 0x11 || (header[3] & 0xFF) != 0xE0) {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi ." + ext);
            }
            return new MagicCheck(true, null);
        }
        if ("7z".equals(ext)) {
            if (header.length < 6 || header[0] != '7' || header[1] != 'z' || (header[2] & 0xFF) != 0xBC) {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi .7z");
            }
            return new MagicCheck(true, null);
        }
        if ("rar".equals(ext)) {
            if (header.length < 6 || header[0] != 'R' || header[1] != 'a' || header[2] != 'r' || header[3] != '!') {
                return new MagicCheck(false, "Nội dung file không khớp với đuôi .rar");
            }
            return new MagicCheck(true, null);
        }

        return new MagicCheck(true, null);
    }

    /**
     * Chuẩn hóa tên file an toàn cho header Content-Disposition: attachment.
     */
    public static String safeDispositionHeader(String name) {
        NameCheck nc = sanitizeName(name);
        String clean = nc.name().replace("\"", "");
        return "attachment; filename=\"" + clean + "\"";
    }
}
