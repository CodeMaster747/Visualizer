package com.visualizer.config;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.visualizer.config.RateLimitFilter.TokenBucket;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.core.annotation.Order;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitFilterTest {

    private RateLimitFilter filter() {
        var props = new AppProperties(
                new AppProperties.Tracers(Map.of("python", "http://x")),
                new AppProperties.Groq("", "http://x", "m", 45, 25),
                new AppProperties.RateLimit(20, 8),
                AppProperties.Azure.disabled(),
                AppProperties.Auth.defaults());
        return new RateLimitFilter(props);
    }

    @Test
    void clientIpUsesRightmostForwardedForEntry() {
        // Caddy appends the true peer, so the rightmost value is the real client;
        // a client-forged leftmost value must NOT be trusted (else rate limiting
        // is trivially bypassed by rotating fake IPs).
        var request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-For", "1.2.3.4, 203.0.113.9");
        assertThat(filter().clientIp(request)).isEqualTo("203.0.113.9");
    }

    @Test
    void clientIpFallsBackToRemoteAddrWithoutHeader() {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("198.51.100.7");
        assertThat(filter().clientIp(request)).isEqualTo("198.51.100.7");
    }

    @Test
    void anonymousCallersAreKeyedByIp() {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("198.51.100.7");
        SecurityContextHolder.clearContext();

        assertThat(filter().rateLimitKey(request)).isEqualTo("ip:198.51.100.7");
    }

    @Test
    void signedInCallersAreKeyedByTokenSubjectNotIp() {
        // Two people behind one NAT must not share a bucket once they have
        // identified themselves, and one person cannot shed a full bucket by
        // moving to a new address.
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("198.51.100.7");
        authenticateAs("user-abc");

        assertThat(filter().rateLimitKey(request)).isEqualTo("sub:user-abc");
    }

    @Test
    void twoUsersOnOneAddressGetSeparateKeys() {
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("203.0.113.9");

        authenticateAs("user-abc");
        String first = filter().rateLimitKey(request);
        authenticateAs("user-xyz");
        String second = filter().rateLimitKey(request);

        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void aSubjectCanNeverCollideWithAnIp() {
        // A hostile subject claim of "198.51.100.7" must not land in the bucket
        // belonging to that address.
        var request = new MockHttpServletRequest();
        request.setRemoteAddr("198.51.100.7");
        authenticateAs("198.51.100.7");

        assertThat(filter().rateLimitKey(request)).isEqualTo("sub:198.51.100.7");
        SecurityContextHolder.clearContext();
        assertThat(filter().rateLimitKey(request)).isEqualTo("ip:198.51.100.7");
    }

    @Test
    void securityChainIsOrderedBeforeThisFilter() {
        // rateLimitKey can only see a subject if Spring Security's chain has
        // already populated the SecurityContext, and "already" means a lower
        // order value. Nothing fails loudly if that stops being true -- the key
        // silently reverts to the IP and per-user limiting quietly disappears --
        // so the relationship is asserted rather than assumed.
        int ours = RateLimitFilter.class.getAnnotation(Order.class).value();

        assertThat(SecurityProperties.DEFAULT_FILTER_ORDER).isLessThan(ours);
    }

    private void authenticateAs(String subject) {
        var jwt = new Jwt(
                "token-value",
                Instant.now(),
                Instant.now().plusSeconds(300),
                Map.of("alg", "RS256"),
                Map.of("sub", subject));
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new JwtAuthenticationToken(jwt, List.of()));
        SecurityContextHolder.setContext(context);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void allowsUpToCapacityThenBlocks() {
        // No refill within the test window (0.001 tokens/sec), so the bucket is
        // effectively just its initial capacity of 3.
        TokenBucket bucket = new TokenBucket(3, 0.001);
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isFalse();
    }

    @Test
    void refillsOverTime() throws InterruptedException {
        // 100 tokens/sec => a token every 10ms. Drain, wait, and it recovers.
        TokenBucket bucket = new TokenBucket(1, 100);
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isFalse();
        Thread.sleep(40);
        assertThat(bucket.tryConsume()).isTrue();
    }

    @Test
    void neverExceedsCapacityOnRefill() throws InterruptedException {
        TokenBucket bucket = new TokenBucket(2, 1000);
        Thread.sleep(20); // would refill 20 tokens if uncapped
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isTrue();
        assertThat(bucket.tryConsume()).isFalse();
    }
}
