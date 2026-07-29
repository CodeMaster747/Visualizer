package com.visualizer.llm;

import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.visualizer.config.AppProperties;
import com.visualizer.trace.TraceHasher;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NarrationServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final TraceHasher hasher = new TraceHasher(mapper);

    private AppProperties props(String apiKey) {
        return new AppProperties(
                new AppProperties.Tracers(Map.of("python", "http://localhost:8081")),
                new AppProperties.Groq(apiKey, "http://groq", "model", 45, 25),
                new AppProperties.RateLimit(20, 8));
    }

    private NarrationService service(GroqClient groq, String apiKey) {
        return new NarrationService(groq, mapper, hasher,
                Caffeine.newBuilder().maximumSize(10).build(), props(apiKey));
    }

    private JsonNode trace(int steps) throws Exception {
        var sb = new StringBuilder("{\"language\":\"python\",\"source\":\"x=1\",\"steps\":[");
        for (int i = 0; i < steps; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"i\":").append(i).append(",\"line\":").append(i + 1)
              .append(",\"event\":\"line\",\"frames\":[{\"id\":\"f0\",\"name\":\"<module>\",")
              .append("\"line\":").append(i + 1).append(",\"locals\":{\"x\":{\"prim\":")
              .append(i).append(",\"prim_type\":\"int\"}}}],\"heap\":{}}");
        }
        sb.append("]}");
        return mapper.readTree(sb.toString());
    }

    @Test
    void disabledGroqYieldsEmptyNotesNotAnError() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(false);

        JsonNode result = service(groq, "").narrate(trace(3));

        assertThat(result.get("notes")).isEmpty();
    }

    @Test
    void parsesAFlatIndexToSentenceMap() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.of("{\"0\":\"Sets x to 0.\",\"1\":\"Sets x to 1.\"}"));

        JsonNode notes = service(groq, "key").narrate(trace(2)).get("notes");

        assertThat(notes.get("0").asText()).isEqualTo("Sets x to 0.");
        assertThat(notes.get("1").asText()).isEqualTo("Sets x to 1.");
    }

    @Test
    void acceptsResponseNestedUnderNotes() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.of("{\"notes\":{\"0\":\"Start.\"}}"));

        JsonNode notes = service(groq, "key").narrate(trace(1)).get("notes");

        assertThat(notes.get("0").asText()).isEqualTo("Start.");
    }

    @Test
    void malformedModelOutputDegradesToEmpty() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any())).thenReturn(Optional.of("not json at all"));

        JsonNode notes = service(groq, "key").narrate(trace(2)).get("notes");

        assertThat(notes).isEmpty();
    }

    @Test
    void aFailedNarrationIsNotCachedAndIsRetried() throws Exception {
        // First call: Groq is down (empty). Second call: Groq recovers. The
        // empty first result must NOT be cached, or the recovery never shows.
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.empty())                                  // outage
                .thenReturn(Optional.of("{\"0\":\"Recovered.\"}"));            // recovery

        NarrationService service = service(groq, "key");
        JsonNode trace = trace(1);

        assertThat(service.narrate(trace).get("notes")).isEmpty();
        assertThat(service.narrate(trace).get("notes").get("0").asText())
                .isEqualTo("Recovered.");
    }

    @Test
    void aSuccessfulNarrationIsCachedAndNotRecomputed() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.of("{\"0\":\"First.\"}"))
                .thenReturn(Optional.of("{\"0\":\"Second.\"}"));

        NarrationService service = service(groq, "key");
        JsonNode trace = trace(1);

        assertThat(service.narrate(trace).get("notes").get("0").asText()).isEqualTo("First.");
        // Second call must return the cached "First.", proving Groq was not hit again.
        assertThat(service.narrate(trace).get("notes").get("0").asText()).isEqualTo("First.");
    }

    @Test
    void notesForStepsBeyondTheTraceAreDropped() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.of("{\"0\":\"Real step.\",\"9\":\"No such step.\"}"));

        JsonNode notes = service(groq, "key").narrate(trace(2)).get("notes");

        assertThat(notes.has("0")).isTrue();
        assertThat(notes.has("9")).isFalse();
    }

    @Test
    void aNoteForAStepTheModelNeverSawIsDropped() throws Exception {
        // A 100-step trace is downsampled, so step 1 is never sent. A sentence
        // about it describes execution the model did not see -- it invented it,
        // and it would be shown against a real step.
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.of("{\"0\":\"Sampled.\",\"1\":\"Invented.\"}"));

        JsonNode notes = service(groq, "key").narrate(trace(100)).get("notes");

        assertThat(notes.has("0")).isTrue();
        assertThat(notes.has("1")).isFalse();
    }

    @Test
    void aTraceWithNoStepsIsNotSentToTheModelAtAll() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);

        JsonNode notes = service(groq, "key").narrate(trace(0)).get("notes");

        assertThat(notes).isEmpty();
        verify(groq, never()).completeJson(any(), any());
    }

    @Test
    void nonIntegerKeysAreRejected() throws Exception {
        GroqClient groq = mock(GroqClient.class);
        when(groq.enabled()).thenReturn(true);
        when(groq.completeJson(any(), any()))
                .thenReturn(Optional.of("{\"0\":\"ok\",\"nope\":\"bad\"}"));

        JsonNode notes = service(groq, "key").narrate(trace(1)).get("notes");

        assertThat(notes.has("0")).isTrue();
        assertThat(notes.has("nope")).isFalse();
    }
}
