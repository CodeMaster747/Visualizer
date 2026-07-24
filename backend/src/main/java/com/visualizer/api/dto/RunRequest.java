package com.visualizer.api.dto;

import java.util.List;
import java.util.Map;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * A request to trace a snippet.
 *
 * `language` selects which tracer service handles it; everything else is passed
 * through untouched. The backend does not parse the code -- validation here is
 * only about bounding size so a giant payload is rejected cheaply before it
 * reaches a tracer.
 */
public record RunRequest(
        @Size(max = 32) String language,
        @NotBlank @Size(max = 200_000, message = "snippet is too large") String source,
        @Size(max = 100_000) String stdin,
        @Size(max = 20) List<SampleFile> files,
        Map<String, Integer> limits
) {
    /** Default to Python; it is the only tracer guaranteed to be present. */
    public String languageOrDefault() {
        return (language == null || language.isBlank()) ? "python" : language;
    }
}
