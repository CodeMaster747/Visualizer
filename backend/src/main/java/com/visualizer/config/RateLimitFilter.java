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
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Rate limiting for the expensive endpoints, keyed per caller.
 *
 * This is not optional on a free-tier box that executes arbitrary code: without
 * it a single client can pin the CPU with a stream of expensive traces. A
 * lightweight in-memory token bucket keeps the backend self-contained; the
 * multi-instance upgrade is Bucket4j backed by Redis, sharing one counter across
 * replicas.
 *
 * "Per caller" means the signed-in user where there is one, and the IP otherwise
 * -- see {@link #rateLimitKey}. Limited endpoints are the two that cost real
 * money or CPU (running code, calling an LLM) plus trace lookup, which is cheap
 * per call but reaches a metered storage account on a miss.
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
        String method = request.getMethod();

        if ("POST".equals(method)) {
            // The two expensive endpoints, plus the two that hand out tokens.
            // Those last two are the only unauthenticated way into the API, so
            // without a limit here the login endpoint is a password-guessing
            // oracle that answers as fast as BCrypt allows. They share the
            // caller's bucket rather than getting their own, which means an
            // attacker spending it on guesses has none left to run code with.
            return !(path.equals("/api/trace")
                    || path.equals("/api/narrate")
                    || path.equals("/api/auth/login")
                    || path.equals("/api/auth/register"));
        }
        // Reading a shared trace is cheap here but bills a transaction against
        // the storage account on a local miss, so it is limited too -- generously,
        // since it never executes anything.
        if ("GET".equals(method)) {
            return !path.startsWith("/api/trace/");
        }
        return true;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String key = rateLimitKey(request);
        TokenBucket bucket = buckets.get(key, k -> new TokenBucket(capacity, refillPerSecond));

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
     * Who this request is charged to: the authenticated user if there is one,
     * otherwise the client IP.
     *
     * Preferring the token subject fixes a real unfairness in IP-only limiting.
     * A university lab, an office, or anyone behind CGNAT presents one address
     * for many people, so a single busy user throttles a whole building; the
     * reverse also holds, since one person on a phone can rotate addresses to
     * shed a bucket. A subject is neither shared nor cheap to rotate -- getting
     * a second one means registering a second account, which is itself rate
     * limited, so the cheapest way to double your quota is to spend part of it.
     *
     * Anonymous callers keep the old IP behaviour, so this is strictly an
     * improvement for signed-in users rather than a new barrier. The prefixes
     * keep the two namespaces from ever colliding.
     *
     * <p>Ordering matters here: Spring Security's chain is registered at order
     * -100 and this filter at 1, so the security context is already populated by
     * the time we look.
     */
    String rateLimitKey(HttpServletRequest request) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken jwt) {
            String subject = jwt.getToken().getSubject();
            if (subject != null && !subject.isBlank()) {
                return "sub:" + subject;
            }
        }
        return "ip:" + clientIp(request);
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
