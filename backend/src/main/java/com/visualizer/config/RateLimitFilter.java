package com.visualizer.config;

import java.io.IOException;
import java.time.Duration;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-IP rate limiting for the run endpoints.
 *
 * This is not optional on a free-tier box that executes arbitrary code: without
 * it a single client can pin the CPU with a stream of expensive traces. A
 * lightweight in-memory token bucket keeps the backend self-contained; the
 * multi-instance upgrade is Bucket4j backed by Redis, sharing one counter across
 * replicas.
 *
 * Only mutating run/narrate calls are limited; health and GETs pass freely.
 */
@Component
@Order(1)
public class RateLimitFilter extends OncePerRequestFilter {

    private final int capacity;
    private final double refillPerSecond;
    private final Cache<String, TokenBucket> buckets;

    public RateLimitFilter(AppProperties props) {
        int perMinute = props.rateLimit().runsPerMinute();
        this.capacity = Math.max(props.rateLimit().burst(), 1);
        this.refillPerSecond = perMinute / 60.0;
        // Buckets expire so idle clients do not leak memory; a returning client
        // simply starts with a full bucket, which is the lenient direction.
        this.buckets = Caffeine.newBuilder()
                .maximumSize(50_000)
                .expireAfterAccess(Duration.ofMinutes(10))
                .build();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        // Only the expensive, mutating endpoints are limited.
        return !("POST".equals(request.getMethod())
                && (path.equals("/api/trace") || path.equals("/api/narrate")));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String ip = clientIp(request);
        TokenBucket bucket = buckets.get(ip, k -> new TokenBucket(capacity, refillPerSecond));

        if (bucket.tryConsume()) {
            chain.doFilter(request, response);
        } else {
            response.setStatus(429);
            response.setContentType("application/json");
            response.getWriter().write(
                    "{\"error\":\"rate_limited\",\"message\":\"Too many runs. Please wait a moment.\"}");
        }
    }

    /**
     * The real client IP, honouring the single trusted proxy in front (Caddy).
     *
     * Takes the RIGHTMOST X-Forwarded-For entry, not the leftmost. Caddy appends
     * the true peer address to whatever the client sent, so a client that sends
     * "X-Forwarded-For: 1.2.3.4" produces "1.2.3.4, <realIP>". Trusting the
     * leftmost value would let anyone mint unlimited rate-limit buckets by
     * rotating a fake header -- a total bypass. The rightmost value is the one
     * Caddy added and the client cannot forge.
     */
    String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            String[] parts = forwarded.split(",");
            return parts[parts.length - 1].trim();
        }
        return request.getRemoteAddr();
    }

    /** A classic token bucket. Synchronised because one client may race itself. */
    static final class TokenBucket {
        private final double capacity;
        private final double refillPerSecond;
        private double tokens;
        private long lastRefillNanos;

        TokenBucket(double capacity, double refillPerSecond) {
            this.capacity = capacity;
            this.refillPerSecond = refillPerSecond;
            this.tokens = capacity;
            this.lastRefillNanos = System.nanoTime();
        }

        synchronized boolean tryConsume() {
            refill();
            if (tokens >= 1.0) {
                tokens -= 1.0;
                return true;
            }
            return false;
        }

        private void refill() {
            long now = System.nanoTime();
            double elapsedSeconds = (now - lastRefillNanos) / 1_000_000_000.0;
            tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
            lastRefillNanos = now;
        }
    }
}
