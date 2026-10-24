package com.workchat.peer;

/**
 * TicketProvider trả chìa phiên Peer Core (RAM) lấy được qua {@code /api/peer/exchange}.
 *
 * <p>Chìa do {@link PeerAutoBinder} cập nhật sau mỗi lần bind. Reconnect (mất mạng)
 * gọi lại {@link #ticket()} và dùng đúng chìa hiện hành. {@link #refresh()} trả null
 * vì chìa chỉ có thể thay bằng một lần bind mới (do trình duyệt khởi tạo).
 */
public final class SessionKeyTicketProvider implements TicketProvider {
    private volatile String key;

    public SessionKeyTicketProvider(String key) {
        this.key = key;
    }

    public void setKey(String key) {
        this.key = key;
    }

    @Override
    public String ticket() {
        return key;
    }
}
