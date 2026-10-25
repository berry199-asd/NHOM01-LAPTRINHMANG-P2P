package com.workchat.tracker.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;

public final class Json {
    public static final ObjectMapper M = new ObjectMapper();

    private Json() {
    }

    public static String write(Object o) {
        try {
            return M.writeValueAsString(o);
        } catch (Exception e) {
            return "{\"error\":\"json_serialize\"}";
        }
    }

    public static JsonNode tree(String s) {
        try {
            return M.readTree(s == null ? "{}" : s);
        } catch (Exception e) {
            return M.createObjectNode();
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> readMap(String s) {
        try {
            if (s == null || s.isBlank()) {
                return Map.of();
            }
            return M.readValue(s, new TypeReference<Map<String, Object>>() {
            });
        } catch (Exception e) {
            return Map.of();
        }
    }
}