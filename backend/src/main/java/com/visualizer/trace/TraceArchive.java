package com.visualizer.trace;

import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Durable, content-addressed storage for trace documents.
 *
 * The Caffeine cache in front of this is bounded and process-local, so it loses
 * everything on restart -- and on a free tier that sleeps after fifteen minutes
 * idle, restarts are the normal case rather than the exception. That is fine for
 * a cache and fatal for a shared link: a URL that stops resolving the moment the
 * dyno naps is not a link worth handing anyone.
 *
 * So this tier exists to outlive the process, not to be fast. It is consulted
 * only after a local miss, which keeps it off the hot path entirely.
 *
 * <p><b>Failures here are never run failures.</b> Every implementation must
 * degrade to "no result" rather than propagate: the archive is an optimisation
 * plus a sharing feature, and neither is worth turning a working trace into a
 * 500 because a storage account was unreachable.
 */
public interface TraceArchive {

    /** The stored document for `key`, or empty on a miss OR any storage error. */
    Optional<JsonNode> find(String key);

    /** Store `doc` under `key`. Silently does nothing if storage is unavailable. */
    void save(String key, JsonNode doc);

    /**
     * Whether a real backing store is configured. Callers use this to describe
     * the deployment (health, share affordances), never to decide whether it is
     * safe to call the other two methods -- both are safe always.
     */
    boolean enabled();

    /**
     * The archive used when no storage is configured: traces live and die with
     * the process, which is precisely the behaviour this project had before
     * Azure was introduced. Sharing degrades to "this link works until the
     * server restarts", and nothing else changes.
     */
    static TraceArchive disabled() {
        return new TraceArchive() {
            @Override
            public Optional<JsonNode> find(String key) {
                return Optional.empty();
            }

            @Override
            public void save(String key, JsonNode doc) {
                // Intentionally empty: no store to save to.
            }

            @Override
            public boolean enabled() {
                return false;
            }
        };
    }
}
