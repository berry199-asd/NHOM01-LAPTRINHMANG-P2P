package com.workchat.peer;

/** Stub TicketProvider cho hạng mục 1: trả token tĩnh đã lấy từ CLI/biến môi trường. */
public final class StaticTokenTicketProvider implements TicketProvider {
    private final String token;

    public StaticTokenTicketProvider(String token) {
        this.token = token;
    }

    @Override
    public String ticket() {
        return token;
    }
}
