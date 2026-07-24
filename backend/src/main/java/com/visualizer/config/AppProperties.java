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
        RateLimit rateLimit
) {
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
}
