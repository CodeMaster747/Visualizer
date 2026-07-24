package com.visualizer.trace;

import com.fasterxml.jackson.databind.JsonNode;
import com.github.benmanes.caffeine.cache.Cache;
import com.visualizer.api.dto.RunRequest;

import org.springframework.stereotype.Service;

/**
 * Orchestrates a run: cache lookup, tracer dispatch, cache store.
 *
 * The cache is content-addressed (see {@link TraceHasher}), so identical
 * submissions -- reloads, shared links, the same example -- never re-execute.
 * Since executing untrusted code is the single most expensive and risky thing
 * this system does, avoiding a re-run whenever possible matters.
 */
@Service
public class TraceService {

    private final TracerClient tracer;
    private final TraceHasher hasher;
    private final Cache<String, JsonNode> cache;

    public TraceService(TracerClient tracer, TraceHasher hasher,
                        Cache<String, JsonNode> traceCache) {
        this.tracer = tracer;
        this.hasher = hasher;
        this.cache = traceCache;
    }

    public boolean supports(String language) {
        return tracer.supports(language);
    }

    /** Trace `req`, serving a cached result when the inputs are unchanged. */
    public JsonNode run(RunRequest req) {
        String language = req.languageOrDefault();
        String key = hasher.hash(language, req);

        JsonNode cached = cache.getIfPresent(key);
        if (cached != null) {
            return cached;
        }
        JsonNode doc = tracer.trace(language, req);
        // Only cache well-formed successes and failures, never a null/garbage
        // response from an unhealthy tracer -- caching that would pin the error.
        if (doc != null && doc.hasNonNull("status")) {
            cache.put(key, doc);
        }
        return doc;
    }
}
