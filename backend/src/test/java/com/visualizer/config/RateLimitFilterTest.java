package com.visualizer.config;

import java.util.Map;

import com.visualizer.config.RateLimitFilter.TokenBucket;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitFilterTest {

    private RateLimitFilter filter() {
        var props = new AppProperties(
                new AppProperties.Tracers(Map.of("python", "http://x")),
                new AppProperties.Groq("", "http://x", "m", 45, 25),
                new AppProperties.RateLimit(20, 8));
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
