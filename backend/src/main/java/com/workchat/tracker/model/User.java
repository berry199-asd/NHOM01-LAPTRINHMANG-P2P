package com.workchat.tracker.model;

public record User(
        long id,
        String username,
        String email,
        String passHash,
        String displayName,
        String role,
        boolean emailVerified
) {
}