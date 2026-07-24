package com.visualizer.trace;

import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizer.api.dto.RunRequest;
import com.visualizer.config.AppProperties;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Talks to a language tracer service (tracer-python, tracer-java).
 *
 * The tracer's response IS the trace document, so this client is a thin pass
 * through: it forwards the run and returns the JSON verbatim. The backend does
 * not need to understand the trace schema to cache or route it.
 */
@Component
public class TracerClient {

    private final RestClient http;
    private final AppProperties props;

    public TracerClient(RestClient.Builder builder, AppProperties props) {
        this.http = builder.build();
        this.props = props;
    }

    public boolean supports(String language) {
        return props.tracers().urlFor(language) != null;
    }

    /** POST the snippet to the tracer for `language` and return the trace document. */
    public JsonNode trace(String language, RunRequest req) {
        String base = props.tracers().urlFor(language);
        if (base == null) {
            throw new UnsupportedLanguageException(language);
        }
        var body = Map.of(
                // Sent so one service can back several languages: tracer-node
                // decides whether to transpile from this, and the tracers that
                // serve a single language simply ignore it.
                "language", language,
                "source", req.source(),
                "stdin", req.stdin() == null ? "" : req.stdin(),
                "files", req.files() == null ? java.util.List.of() : req.files(),
                "limits", req.limits() == null ? Map.of() : req.limits()
        );
        return http.post()
                .uri(base + "/trace")
                .body(body)
                .retrieve()
                .body(JsonNode.class);
    }

    /** Fetch a tracer's health, or null if it is unreachable. */
    public JsonNode health(String language) {
        String base = props.tracers().urlFor(language);
        if (base == null) {
            return null;
        }
        try {
            return http.get().uri(base + "/health").retrieve().body(JsonNode.class);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Thrown when a request names a language with no configured tracer. */
    public static class UnsupportedLanguageException extends RuntimeException {
        public UnsupportedLanguageException(String language) {
            super("No tracer is configured for language '" + language + "'.");
        }
    }
}
