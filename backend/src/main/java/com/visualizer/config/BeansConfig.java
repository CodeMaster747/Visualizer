package com.visualizer.config;

import java.time.Duration;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Shared infrastructure beans: the HTTP client used to reach tracers and Groq,
 * and the two content-addressed caches.
 */
@Configuration
public class BeansConfig {

    /**
     * RestClient with explicit timeouts. Without them a hung tracer or a slow
     * LLM would tie up a request thread indefinitely; the tracer's own budget is
     * ~30s, so 40s here is the outer bound.
     */
    @Bean
    RestClient.Builder restClientBuilder() {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(40));
        return RestClient.builder().requestFactory(factory);
    }

    /**
     * Trace cache, keyed by a hash of the run request. Identical submissions are
     * common (reloading, sharing a link, the same example), and a trace is
     * deterministic, so this turns a repeat run into a map lookup.
     */
    @Bean
    Cache<String, JsonNode> traceCache() {
        return Caffeine.newBuilder()
                .maximumSize(500)
                .expireAfterWrite(Duration.ofHours(6))
                .build();
    }

    /**
     * Narration cache, keyed by trace hash. Narration costs an LLM call and the
     * same trace always yields the same explanation, so it is cached separately
     * from the trace itself (a trace may be cached before it is ever narrated).
     */
    @Bean
    Cache<String, JsonNode> narrationCache() {
        return Caffeine.newBuilder()
                .maximumSize(500)
                .expireAfterWrite(Duration.ofHours(6))
                .build();
    }
}
