package com.visualizer.llm;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizer.config.AppProperties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Minimal client for Groq's OpenAI-compatible chat completions API.
 *
 * Groq is used purely for narration, which is optional: every method here fails
 * soft. A missing key, a network error, or a malformed response yields an empty
 * Optional, never an exception that could take down a trace request.
 */
@Component
public class GroqClient {

    private static final Logger log = LoggerFactory.getLogger(GroqClient.class);

    private final RestClient http;
    private final AppProperties.Groq cfg;

    public GroqClient(RestClient.Builder builder, AppProperties props) {
        this.http = builder.build();
        this.cfg = props.groq();
    }

    public boolean enabled() {
        return cfg.enabled();
    }

    public String model() {
        return cfg.model();
    }

    /**
     * Run a single JSON-mode completion and return the assistant's raw content
     * (expected to be a JSON object string). Empty on any failure.
     */
    public java.util.Optional<String> completeJson(String systemPrompt, String userPrompt) {
        if (!cfg.enabled()) {
            return java.util.Optional.empty();
        }
        var body = Map.of(
                "model", cfg.model(),
                "temperature", 0.2,
                // Force valid JSON so we never have to salvage prose.
                "response_format", Map.of("type", "json_object"),
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userPrompt)
                )
        );
        try {
            JsonNode resp = http.post()
                    .uri(cfg.baseUrl() + "/chat/completions")
                    .header("Authorization", "Bearer " + cfg.apiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(JsonNode.class);

            String content = resp
                    .path("choices").path(0).path("message").path("content").asText(null);
            if (content == null || content.isBlank()) {
                log.warn("Groq returned no content");
                return java.util.Optional.empty();
            }
            return java.util.Optional.of(content);
        } catch (RuntimeException e) {
            // Rate limit, timeout, bad key, model retired -- all non-fatal here.
            log.warn("Groq completion failed: {}", e.getMessage());
            return java.util.Optional.empty();
        }
    }
}
