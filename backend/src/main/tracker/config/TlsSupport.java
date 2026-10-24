package com.workchat.tracker.config;

import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;

import javax.net.ssl.SSLException;
import java.io.File;

/**
 * Dựng {@link SslContext} cho Tracker từ chứng chỉ PEM (cert chain) + khoá riêng PEM.
 * Netty đọc trực tiếp PEM PKCS#8 (khoá không mã hoá) hoặc PEM có mật khẩu.
 *
 * <p>TLS tại tầng ứng dụng là tuỳ chọn. Khuyến nghị production dùng reverse-proxy
 * (Caddy/nginx + Let's Encrypt) — xem {@code docs/TLS_WSS.md}.
 */
public final class TlsSupport {
    private TlsSupport() {
    }

    /** Dựng SslContext từ file PEM; ném {@link SSLException} nếu thiếu/không hợp lệ. */
    public static SslContext buildContext(String certFile, String keyFile, String keyPassword) throws SSLException {
        File cert = new File(certFile);
        File key = new File(keyFile);
        if (!cert.isFile()) {
            throw new SSLException("Không thấy file chứng chỉ TLS: " + certFile);
        }
        if (!key.isFile()) {
            throw new SSLException("Không thấy file khoá TLS: " + keyFile);
        }
        SslContextBuilder builder = SslContextBuilder.forServer(cert, key,
                (keyPassword == null || keyPassword.isEmpty()) ? null : keyPassword);
        return builder.build();
    }

    /** Dựng SslContext theo cấu hình (chỉ gọi khi {@link AppConfig#tlsConfigured()} đúng). */
    public static SslContext buildContext(AppConfig cfg) throws SSLException {
        return buildContext(cfg.tlsCertFile(), cfg.tlsKeyFile(), cfg.tlsKeyPassword());
    }
}
