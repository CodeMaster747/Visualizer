package com.visualizer.config;

import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * All externally-tunable configuration in one typed place.
 *
 * Bound from application.yml and overridable by environment variables
 * (VISUALIZER_TRACERS_PYTHON, VISUALIZER_GROQ_APIKEY, ...), which is how the
 * deployment injects the Groq key and the tracer URLs without a rebuild.
 */
@ConfigurationProperties(prefix = "visualizer")
public record AppProperties(
        Tracers tracers,
        Groq groq,
        RateLimit rateLimit,
        Azure azure
) {
    /**
     * A deployment with no `visualizer.azure` block at all is the common case,
     * so it is normalised here into the same "disabled" shape an explicitly
     * empty block produces. Callers then read `azure().storage().enabled()`
     * without a null check at any level.
     */
    public AppProperties {
        azure = azure == null ? Azure.disabled() : azure;
    }

    /**
     * Base URL of each language tracer, keyed by the `language` field in a run
     * request. A language with no entry here is simply unsupported, reported as
     * a 400 rather than a crash.
     */
    public record Tracers(Map<String, String> urls) {
        public String urlFor(String language) {
            return urls == null ? null : urls.get(language);
        }
    }

    public record Groq(
            String apiKey,
            String baseUrl,
            String model,
            int maxStepsPerRequest,
            int timeoutSeconds
    ) {
        /** Narration is simply disabled, never errored, when no key is set. */
        public boolean enabled() {
            return apiKey != null && !apiKey.isBlank();
        }
    }

    public record RateLimit(int runsPerMinute, int burst) {}

    /**
     * Azure integration, both halves optional and independently so.
     *
     * Every deployment target this project has had -- a laptop, docker compose
     * on one VM, Render's free tier -- must keep working with no Azure account
     * at all, so neither half is allowed to be load-bearing. Unset storage means
     * the trace cache is process-local again; unset auth means the API is open,
     * exactly as it was before. This mirrors how {@link Groq} treats a missing
     * key: a disabled feature, never an error.
     */
    public record Azure(Storage storage, Auth auth) {

        /** Same normalisation one level down: a half-filled block is still usable. */
        public Azure {
            storage = storage == null ? new Storage("", DEFAULT_CONTAINER) : storage;
            auth = auth == null ? new Auth("", "") : auth;
        }

        public static Azure disabled() {
            return new Azure(null, null);
        }

        static final String DEFAULT_CONTAINER = "traces";

        /**
         * @param connectionString full storage connection string, or a blank
         *        value to disable the durable tier. Carries the account key, so
         *        it comes from the environment and is never committed.
         * @param container blob container holding the trace documents.
         */
        public record Storage(String connectionString, String container) {
            /** The container name is the one piece with a sensible default. */
            public Storage {
                container = (container == null || container.isBlank())
                        ? DEFAULT_CONTAINER
                        : container;
            }

            public boolean enabled() {
                return connectionString != null && !connectionString.isBlank();
            }
        }

        /**
         * @param issuerUri the External ID tenant's OIDC issuer. Blank leaves the
         *        API unauthenticated.
         * @param audience the API application's client ID. Checked explicitly
         *        because issuer validation alone would accept a token minted for
         *        a different application in the same tenant.
         */
        public record Auth(String issuerUri, String audience) {
            public boolean enabled() {
                return issuerUri != null && !issuerUri.isBlank();
            }
        }
    }
}
