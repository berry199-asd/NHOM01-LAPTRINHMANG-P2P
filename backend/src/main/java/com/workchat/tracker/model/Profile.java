package com.workchat.tracker.model;

public record Profile(
        long id,
        String username,
        String email,
        String displayName,
        String role,
        boolean emailVerified,
        String bio,
        String phone,
        String dateOfBirth,
        String createdAt,
        boolean showPhone,
        String avatar,
        String cover
) {
}