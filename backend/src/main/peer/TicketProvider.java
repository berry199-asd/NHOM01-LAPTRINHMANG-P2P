package com.workchat.peer;

/**
 * Nguồn cấp vé (token) để Peer Core xác thực với Tracker.
 *
 * <p>Có hai hiện thực: {@link StaticTokenTicketProvider} (chế độ gỡ lỗi, token tĩnh)
 * và {@link SessionKeyTicketProvider} (chìa phiên Peer Core lấy qua exchange, có thể
 * làm mới). {@link PeerRegistrationService} gọi {@link #ticket()} mỗi lần đăng ký lại
 * nên reconnect tự động dùng chìa hiện hành mà không cần sửa gì thêm.
 */
public interface TicketProvider {
    /** Vé/chìa hiện hành. Có thể được gọi lại mỗi lần đăng ký lại. */
    String ticket();

    /**
     * Làm mới vé/chìa khi bị từ chối (401). Trả về vé mới nếu làm mới được,
     * ngược lại trả {@code null} để báo phiên đã hết hạn.
     */
    default String refresh() {
        return null;
    }
}
