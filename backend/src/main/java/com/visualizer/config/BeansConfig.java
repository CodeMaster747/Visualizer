package com.visualizer.config;

import java.time.Duration;

import com.azure.storage.blob.BlobServiceClientBuilder;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.visualizer.trace.BlobTraceArchive;
import com.visualizer.trace.TraceArchive;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Shared infrastructure beans: the HTTP client used to reach tracers and Groq,
 * the two content-addressed caches, and the durable tier behind them.
 */
@Configuration
public class BeansConfig {

    private static final Logger log = LoggerFactory.getLogger(BeansConfig.class);

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

    /**
     * The durable tier behind the trace cache, present only when a storage
     * account is configured.
     *
     * Resolved once here rather than checked at each call site, so the rest of
     * the code depends on the {@link TraceArchive} interface and never on
     * whether this deployment has Azure. Without a connection string the app is
     * byte-for-byte the single-VM app it was before -- which is the point: the
     * blob tier is an upgrade to the deployment, not a dependency of the design.
     */
    @Bean
    TraceArchive traceArchive(AppProperties props, ObjectMapper mapper) {
        var storage = props.azure().storage();
        if (!storage.enabled()) {
            log.info("Trace archive disabled: no Azure storage connection string. "
                    + "Traces are cached in memory only and shared links expire on restart.");
            return TraceArchive.disabled();
        }

        var client = new BlobServiceClientBuilder()
                .connectionString(storage.connectionString())
                .buildClient()
                .getBlobContainerClient(storage.container());

        log.info("Trace archive enabled: Azure Blob Storage container '{}'.", storage.container());
        return new BlobTraceArchive(client, mapper);
    }
}
