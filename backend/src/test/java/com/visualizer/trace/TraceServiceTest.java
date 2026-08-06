package com.visualizer.trace;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.visualizer.api.dto.RunRequest;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The three tiers in cost order: memory, archive, then actually executing code.
 * Each test here pins the boundary between two of them, because the whole point
 * of the arrangement is that the expensive tier is reached as rarely as possible.
 */
class TraceServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final TraceHasher hasher = new TraceHasher(mapper);
    private final TracerClient tracer = mock(TracerClient.class);
    private final TraceArchive archive = mock(TraceArchive.class);
    private final Cache<String, JsonNode> cache = Caffeine.newBuilder().build();

    private final TraceService service = new TraceService(tracer, hasher, cache, archive);

    private final RunRequest request = new RunRequest("python", "x = 1", "", List.of(), Map.of());
    private final JsonNode ok = mapper.createObjectNode().put("status", "ok");

    @Test
    void freshRunExecutesThenFillsBothTiers() {
        when(archive.find(anyString())).thenReturn(Optional.empty());
        when(tracer.trace(anyString(), any())).thenReturn(ok);

        assertThat(service.run(request)).isEqualTo(ok);

        String id = service.idFor(request);
        assertThat(cache.getIfPresent(id)).isEqualTo(ok);
        verify(archive).save(id, ok);
    }

    @Test
    void memoryHitSkipsArchiveAndTracer() {
        cache.put(service.idFor(request), ok);

        assertThat(service.run(request)).isEqualTo(ok);

        verify(archive, never()).find(anyString());
        verify(tracer, never()).trace(anyString(), any());
    }

    @Test
    void archiveHitSkipsExecutionAndWarmsMemory() {
        // The case that justifies the whole tier: the process restarted, so
        // Caffeine is empty, but the code must not run a second time.
        when(archive.find(anyString())).thenReturn(Optional.of(ok));

        assertThat(service.run(request)).isEqualTo(ok);

        verify(tracer, never()).trace(anyString(), any());
        assertThat(cache.getIfPresent(service.idFor(request))).isEqualTo(ok);
    }

    @Test
    void secondRunAfterArchiveHitDoesNotConsultArchiveAgain() {
        when(archive.find(anyString())).thenReturn(Optional.of(ok));

        service.run(request);
        service.run(request);

        // Promoted on the first call, so the second is served from memory --
        // otherwise every repeat run would bill a storage transaction.
        verify(archive, times(1)).find(anyString());
    }

    @Test
    void malformedTracerOutputIsNeitherCachedNorArchived() {
        // Pinning a garbage response would make one unhealthy tracer poison
        // every later request for the same snippet.
        when(archive.find(anyString())).thenReturn(Optional.empty());
        when(tracer.trace(anyString(), any())).thenReturn(mapper.createObjectNode());

        service.run(request);

        assertThat(cache.getIfPresent(service.idFor(request))).isNull();
        verify(archive, never()).save(anyString(), any());
    }

    @Test
    void findByIdNeverExecutesAnything() {
        // A shared link resolves an id, and an id is not a request. If a miss
        // could run code, a link would be a remote execution primitive.
        when(archive.find(anyString())).thenReturn(Optional.empty());

        assertThat(service.findById("b".repeat(64))).isEmpty();

        verify(tracer, never()).trace(anyString(), any());
    }

    @Test
    void findByIdPromotesArchivedTraceIntoMemory() {
        String id = "c".repeat(64);
        when(archive.find(id)).thenReturn(Optional.of(ok));

        assertThat(service.findById(id)).contains(ok);
        assertThat(cache.getIfPresent(id)).isEqualTo(ok);
    }
}
