package com.visualizer.config;

import java.nio.file.Path;
import java.time.Duration;
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
        Azure azure,
        Auth auth
) {
    /**
     * A deployment with no `visualizer.azure` block at all is the common case,
     * so it is normalised here into the same "disabled" shape an explicitly
     * empty block produces. Callers then read `azure().storage().enabled()`
     * without a null check at any level. `auth` gets the same treatment, except
     * that its defaults are a working configuration rather than a disabled one.
     */
    public AppProperties {
        azure = azure == null ? Azure.disabled() : azure;
        auth = auth == null ? Auth.defaults() : auth;
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
     * Accounts: where they are stored, how long a session lasts, and what signs
     * it.
     *
     * Unlike every other block here, this one has no "off" state. Authentication
     * is self-hosted -- the API mints and verifies its own tokens with no
     * identity provider behind it -- so there is no external dependency that
     * could be unavailable and nothing to configure before it works. Every value
     * below has a default that runs, which is what lets `docker compose up` on a
     * fresh clone produce a working sign-up.
     *
     * <p>That is a deliberate reversal of the pattern the Azure block follows,
     * and the reason is the failure it removes. When authentication depended on
     * a tenant, the API and the browser each had to be told about it separately,
     * and configuring one without the other produced a build that showed a
     * sign-in form and then rejected every request the signed-in user made. With
     * nothing to configure, those two halves cannot disagree.
     *
     * @param secret HMAC signing secret. Blank means one is generated and saved
     *        under {@code dataDir}, which keeps sessions alive across restarts
     *        but not across a redeploy that replaces the filesystem.
     * @param dataDir directory holding the account file and the generated key.
     *        Must be writable by the user the process runs as.
     * @param tokenTtlMinutes how long an access token stays valid. There are no
     *        refresh tokens, so this is also how long a session lasts.
     */
    public record Auth(String secret, String dataDir, int tokenTtlMinutes) {

        static final String DEFAULT_DATA_DIR = "data";

        /** Twelve hours: a working day, so nobody is signed out mid-session. */
        static final int DEFAULT_TTL_MINUTES = 720;

        public Auth {
            secret = secret == null ? "" : secret.trim();
            dataDir = (dataDir == null || dataDir.isBlank()) ? DEFAULT_DATA_DIR : dataDir.trim();
            tokenTtlMinutes = tokenTtlMinutes <= 0 ? DEFAULT_TTL_MINUTES : tokenTtlMinutes;
        }

        public static Auth defaults() {
            return new Auth("", null, 0);
        }

        /** False means "generate and persist one", not "disable authentication". */
        public boolean hasConfiguredSecret() {
            return !secret.isBlank();
        }

        public Path dataPath() {
            return Path.of(dataDir);
        }

        public Duration tokenTtl() {
            return Duration.ofMinutes(tokenTtlMinutes);
        }
    }

    /**
     * Azure Blob storage for traces, optional as it has always been.
     *
     * Every deployment target this project has had -- a laptop, docker compose
     * on one VM, Render's free tier -- must keep working with no Azure account
     * at all, so it is not allowed to be load-bearing. Unset means the trace
     * cache is process-local again, mirroring how {@link Groq} treats a missing
     * key: a disabled feature, never an error.
     */
    public record Azure(Storage storage) {

        /** Same normalisation one level down: an empty block is still usable. */
        public Azure {
            storage = storage == null ? new Storage("", DEFAULT_CONTAINER) : storage;
        }

        public static Azure disabled() {
            return new Azure(null);
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
    }
}
