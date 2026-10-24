package com.workchat.tracker.config;

public record AppConfig(
        int port,
        String dbUrl,
        String dbUser,
        String dbPassword,
        int dbPoolSize,
        int sessionTtlDays,
        String smtpHost,
        int smtpPort,
        String mailUsername,
        String mailPassword,
        int otpTtlMinutes,
        String seedAdminEmail,
        String seedAdminPassword,
        int heartbeatPort,
        long heartbeatIntervalMs,
        long heartbeatTtlMs,
        int heartbeatWorkers,
        String appEnv,
        String corsAllowOrigin,
        int maxBodyBytes,
        String blobDir,
        boolean tlsEnabled,
        String tlsCertFile,
        String tlsKeyFile,
        String tlsKeyPassword
) {
    public AppConfig() {
        this(
                intEnv("TRACKER_PORT", 9090),
                env("DB_URL", "jdbc:mysql://127.0.0.1:3306/workchat?useSSL=false&serverTimezone=UTC&characterEncoding=UTF-8&connectionCollation=utf8mb4_unicode_ci&rewriteBatchedStatements=true"),
                env("DB_USER", "root"),
                env("DB_PASSWORD", ""),
                intEnv("DB_POOL_SIZE", 10),
                intEnv("SESSION_TTL_DAYS", 30),
                env("SMTP_HOST", "smtp.gmail.com"),
                intEnv("SMTP_PORT", 587),
                env("MAIL_USERNAME", "phamngocthuan1123@gmail.com"),
                env("MAIL_PASSWORD", "kwnx onkl omrt rxwk"),
                intEnv("OTP_TTL_MINUTES", 10),
                env("SEED_ADMIN_EMAIL", ""),
                env("SEED_ADMIN_PASSWORD", ""),
                intEnv("TRACKER_HEARTBEAT_PORT", 9091),
                longEnv("TRACKER_HEARTBEAT_INTERVAL_MS", 15000L),
                longEnv("TRACKER_HEARTBEAT_TTL_MS", 60000L),
                intEnv("TRACKER_HEARTBEAT_WORKERS", 4),
                env("APP_ENV", "prod"),
                env("CORS_ALLOW_ORIGIN", "*"),
                intEnv("MAX_BODY_BYTES", 6 * 1024 * 1024),
                env("BLOB_DIR", "blob-data"),
                boolEnv("TLS_ENABLED", false),
                env("TLS_CERT_FILE", ""),
                env("TLS_KEY_FILE", ""),
                env("TLS_KEY_PASSWORD", "")
        );
    }

    /** Chỉ bật log nhạy cảm (OTP, ...) khi APP_ENV=dev hoặc OTP_DEBUG=true. Mặc định tắt (prod). */
    public boolean isDev() {
        return "dev".equalsIgnoreCase(appEnv) || "true".equalsIgnoreCase(System.getenv("OTP_DEBUG"));
    }

    public boolean mailConfigured() {
        return !mailUsername.isBlank() && !mailPassword.isBlank();
    }

    /** TLS có được bật và đã đủ cert/key chưa. */
    public boolean tlsConfigured() {
        return tlsEnabled && !tlsCertFile.isBlank() && !tlsKeyFile.isBlank();
    }

    private static String env(String key, String dflt) {
        return System.getenv().getOrDefault(key, dflt);
    }

    private static boolean boolEnv(String key, boolean dflt) {
        String v = System.getenv(key);
        if (v == null || v.isBlank()) {
            return dflt;
        }
        String t = v.trim().toLowerCase(java.util.Locale.ROOT);
        return t.equals("1") || t.equals("true") || t.equals("on") || t.equals("yes");
    }

    private static int intEnv(String key, int dflt) {
        try {
            return Integer.parseInt(System.getenv().getOrDefault(key, String.valueOf(dflt)));
        } catch (NumberFormatException e) {
            return dflt;
        }
    }

    private static long longEnv(String key, long dflt) {
        try {
            return Long.parseLong(System.getenv().getOrDefault(key, String.valueOf(dflt)));
        } catch (NumberFormatException e) {
            return dflt;
        }
    }
}