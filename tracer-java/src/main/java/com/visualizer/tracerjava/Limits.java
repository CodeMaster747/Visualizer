package com.visualizer.tracerjava;

import java.util.Map;

/**
 * Execution and snapshot caps, mirroring the Python tracer so both languages
 * behave the same and produce comparably sized traces.
 */
public record Limits(
        int maxSteps,
        int maxDepth,
        int maxItems,
        int maxString,
        int timeoutMs
) {
    public static Limits defaults() {
        return new Limits(5000, 6, 100, 512, 10_000);
    }

    /** Build from untrusted client input, clamping every field. */
    public static Limits clamp(Map<String, Integer> raw) {
        Limits d = defaults();
        if (raw == null) {
            return d;
        }
        return new Limits(
                clamp(raw.get("max_steps"), d.maxSteps, 10, 20_000),
                clamp(raw.get("max_depth"), d.maxDepth, 1, 12),
                clamp(raw.get("max_items"), d.maxItems, 1, 500),
                clamp(raw.get("max_string"), d.maxString, 16, 4_000),
                clamp(raw.get("timeout_ms"), d.timeoutMs, 500, 20_000)
        );
    }

    private static int clamp(Integer value, int fallback, int lo, int hi) {
        if (value == null) {
            return fallback;
        }
        return Math.max(lo, Math.min(value, hi));
    }

    public Map<String, Integer> asMap() {
        return Map.of(
                "max_steps", maxSteps,
                "max_depth", maxDepth,
                "max_items", maxItems,
                "max_string", maxString,
                "timeout_ms", timeoutMs
        );
    }
}
