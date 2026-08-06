package com.visualizer.trace;

import java.util.Optional;

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
 *
 * There are three tiers under that idea, in strict cost order: Caffeine in this
 * process, then the {@link TraceArchive} over the network, then actually running
 * the code. Each is roughly an order of magnitude dearer than the one before,
 * and the archive earns the middle rung because a restart empties Caffeine but
 * not blob storage -- so a link shared yesterday resolves today without
 * re-executing anything.
 */
@Service
public class TraceService {

    private final TracerClient tracer;
    private final TraceHasher hasher;
    private final Cache<String, JsonNode> cache;
    private final TraceArchive archive;

    public TraceService(TracerClient tracer, TraceHasher hasher,
                        Cache<String, JsonNode> traceCache, TraceArchive archive) {
        this.tracer = tracer;
        this.hasher = hasher;
        this.cache = traceCache;
        this.archive = archive;
    }

    public boolean supports(String language) {
        return tracer.supports(language);
    }

    /** Whether traces outlive this process, i.e. whether a shared link is durable. */
    public boolean archiveEnabled() {
        return archive.enabled();
    }

    /** The content-addressed id for a request, without running anything. */
    public String idFor(RunRequest req) {
        return hasher.hash(req.languageOrDefault(), req);
    }

    /**
     * Look up an already-executed trace by id.
     *
     * This is what makes a shared link work, and it deliberately cannot run
     * anything: an id is not a request, so a link to a trace nobody has executed
     * is a miss rather than an invitation to execute code on behalf of whoever
     * opened it.
     */
    public Optional<JsonNode> findById(String id) {
        JsonNode local = cache.getIfPresent(id);
        if (local != null) {
            return Optional.of(local);
        }
        Optional<JsonNode> stored = archive.find(id);
        stored.ifPresent(doc -> cache.put(id, doc));
        return stored;
    }

    /** Trace `req`, serving a cached result when the inputs are unchanged. */
    public JsonNode run(RunRequest req) {
        String language = req.languageOrDefault();
        String key = hasher.hash(language, req);

        JsonNode cached = cache.getIfPresent(key);
        if (cached != null) {
            return cached;
        }

        // Promote an archived trace back into memory rather than re-running it.
        Optional<JsonNode> archived = archive.find(key);
        if (archived.isPresent()) {
            cache.put(key, archived.get());
            return archived.get();
        }

        JsonNode doc = tracer.trace(language, req);
        // Only cache well-formed successes and failures, never a null/garbage
        // response from an unhealthy tracer -- caching that would pin the error.
        if (doc != null && doc.hasNonNull("status")) {
            cache.put(key, doc);
            archive.save(key, doc);
        }
        return doc;
    }
}
