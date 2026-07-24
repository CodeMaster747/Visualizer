package com.visualizer.trace;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizer.api.dto.RunRequest;
import com.visualizer.api.dto.SampleFile;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TraceHasherTest {

    private final TraceHasher hasher = new TraceHasher(new ObjectMapper());

    private RunRequest req(String source, String stdin) {
        return new RunRequest("python", source, stdin, List.of(), Map.of());
    }

    @Test
    void identicalInputsHashIdentically() {
        assertThat(hasher.hash("python", req("x = 1", "")))
                .isEqualTo(hasher.hash("python", req("x = 1", "")));
    }

    @Test
    void differentSourceHashesDifferently() {
        assertThat(hasher.hash("python", req("x = 1", "")))
                .isNotEqualTo(hasher.hash("python", req("x = 2", "")));
    }

    @Test
    void differentLanguageHashesDifferently() {
        assertThat(hasher.hash("python", req("x = 1", "")))
                .isNotEqualTo(hasher.hash("java", req("x = 1", "")));
    }

    @Test
    void stdinIsPartOfTheKey() {
        assertThat(hasher.hash("python", req("input()", "a")))
                .isNotEqualTo(hasher.hash("python", req("input()", "b")));
    }

    @Test
    void uploadedFilesArePartOfTheKey() {
        var withFile = new RunRequest("python", "x=1", "",
                List.of(new SampleFile("a.csv", "1,2")), Map.of());
        var withoutFile = new RunRequest("python", "x=1", "", List.of(), Map.of());
        assertThat(hasher.hash("python", withFile))
                .isNotEqualTo(hasher.hash("python", withoutFile));
    }

    @Test
    void producesAHexSha256() {
        String h = hasher.hash("python", req("x = 1", ""));
        assertThat(h).hasSize(64).matches("[0-9a-f]+");
    }
}
