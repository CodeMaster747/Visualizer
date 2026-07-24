package com.visualizer.api.dto;

import jakarta.validation.constraints.Size;

/** An uploaded dataset made available to the snippet by name. */
public record SampleFile(
        @Size(max = 255) String name,
        @Size(max = 5_000_000) String content
) {}
