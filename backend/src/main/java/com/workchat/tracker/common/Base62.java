package com.workchat.tracker.common;

import java.security.SecureRandom;

/** Chuỗi ngẫu nhiên base62 (0-9A-Za-z), dùng cho public_id hoặc mã mời phòng. */
public final class Base62 {
    private static final char[] ALPHABET =
            ("ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "abcdefghijklmnopqrstuvwxyz" + "0123456789").toCharArray();
    private static final SecureRandom RNG = new SecureRandom();

    private Base62() {
    }

    public static String random(int len) {
        if (len < 1) {
            throw new IllegalArgumentException("len must be >= 1");
        }
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) {
            sb.append(ALPHABET[RNG.nextInt(ALPHABET.length)]);
        }
        return sb.toString();
    }

    /** public_id dài 12-16 ký tự (mỗi lần sinh ngẫu nhiên độ dài). */
    public static String publicId() {
        return random(12 + RNG.nextInt(5));
    }
}