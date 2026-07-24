package com.visualizer.llm;

import java.util.ArrayList;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.github.benmanes.caffeine.cache.Cache;
import com.visualizer.config.AppProperties;
import com.visualizer.trace.TraceHasher;

import org.springframework.stereotype.Service;

/**
 * Turns a trace document into per-step plain-English narration via Groq.
 *
 * Two decisions keep this cheap and robust:
 *
 *  - ONE batched call over a downsampled trace, never one call per step. A
 *    500-step trace would otherwise be 500 LLM round-trips; instead we sample a
 *    handful of representative steps and let the UI carry each note forward
 *    until the next.
 *
 *  - Fail soft. Narration is additive. If Groq is disabled, slow, or returns
 *    junk, this returns an empty object and the visualization is unaffected.
 */
@Service
public class NarrationService {

    private final GroqClient groq;
    private final ObjectMapper mapper;
    private final TraceHasher hasher;
    private final Cache<String, JsonNode> cache;
    private final int maxSteps;

    public NarrationService(GroqClient groq, ObjectMapper mapper, TraceHasher hasher,
                            Cache<String, JsonNode> narrationCache, AppProperties props) {
        this.groq = groq;
        this.mapper = mapper;
        this.hasher = hasher;
        this.cache = narrationCache;
        this.maxSteps = props.groq().maxStepsPerRequest();
    }

    public boolean enabled() {
        return groq.enabled();
    }

    /** {@code {"notes": {stepIndex: sentence}}}. Empty notes on any failure. */
    public ObjectNode narrate(JsonNode trace) {
        ObjectNode result = mapper.createObjectNode();
        ObjectNode notes = result.putObject("notes");

        if (!groq.enabled() || trace == null || !trace.path("steps").isArray()) {
            return result;
        }

        // Cache by trace identity: the same trace always narrates the same way.
        String key = hasher.hashString(trace.path("steps").toString()
                + trace.path("source").asText(""));
        JsonNode cached = cache.getIfPresent(key);
        if (cached != null) {
            return (ObjectNode) cached;
        }

        List<Integer> sampled = sampleIndices(trace.path("steps").size());
        String user = buildPrompt(trace, sampled);

        groq.completeJson(SYSTEM_PROMPT, user).ifPresent(content -> {
            try {
                JsonNode parsed = mapper.readTree(content);
                // The model may nest under "notes" or return a flat map; accept both.
                JsonNode map = parsed.has("notes") ? parsed.get("notes") : parsed;
                map.fields().forEachRemaining(e -> {
                    String sentence = e.getValue().asText("").trim();
                    if (!sentence.isEmpty() && isInteger(e.getKey())) {
                        notes.put(e.getKey(), sentence);
                    }
                });
            } catch (Exception ignored) {
                // Malformed model output -> no notes, nothing broken.
            }
        });

        // Only cache a real result. Caching an empty result (Groq was down,
        // rate-limited, or returned junk) would pin that failure forever, so a
        // single transient outage would permanently disable narration for this
        // trace. An empty result is retried on the next request instead.
        if (!notes.isEmpty()) {
            cache.put(key, result);
        }
        return result;
    }

    /** Evenly spaced step indices, always including the first and last. */
    private List<Integer> sampleIndices(int stepCount) {
        List<Integer> out = new ArrayList<>();
        if (stepCount <= 0) {
            return out;
        }
        if (stepCount <= maxSteps) {
            for (int i = 0; i < stepCount; i++) {
                out.add(i);
            }
            return out;
        }
        // stride > 1: pick maxSteps points across the range, de-duplicated.
        double stride = (double) (stepCount - 1) / (maxSteps - 1);
        int last = -1;
        for (int k = 0; k < maxSteps; k++) {
            int idx = (int) Math.round(k * stride);
            if (idx != last) {
                out.add(idx);
                last = idx;
            }
        }
        return out;
    }

    private String buildPrompt(JsonNode trace, List<Integer> indices) {
        StringBuilder sb = new StringBuilder();
        sb.append("Language: ").append(trace.path("language").asText("python")).append("\n\n");
        sb.append("Source code:\n").append(trace.path("source").asText("")).append("\n\n");
        sb.append("Execution steps (explain each by its index):\n");

        JsonNode steps = trace.path("steps");
        for (int idx : indices) {
            JsonNode step = steps.get(idx);
            if (step == null) {
                continue;
            }
            sb.append('#').append(idx)
              .append(" line ").append(step.path("line").asInt())
              .append(' ').append(step.path("event").asText("line"))
              .append("  vars: ").append(renderInnermostLocals(step))
              .append('\n');
        }
        return sb.toString();
    }

    /** Compact "name=value" view of the innermost frame, for the LLM's context. */
    private String renderInnermostLocals(JsonNode step) {
        JsonNode frames = step.path("frames");
        if (!frames.isArray() || frames.isEmpty()) {
            return "{}";
        }
        JsonNode frame = frames.get(frames.size() - 1);
        JsonNode heap = step.path("heap");
        StringBuilder sb = new StringBuilder("{");
        JsonNode locals = frame.path("locals");
        var it = locals.fields();
        int shown = 0;
        while (it.hasNext() && shown < 8) {
            var e = it.next();
            if (shown > 0) {
                sb.append(", ");
            }
            sb.append(e.getKey()).append('=').append(renderValue(e.getValue(), heap));
            shown++;
        }
        return sb.append('}').toString();
    }

    private String renderValue(JsonNode value, JsonNode heap) {
        if (value.has("prim")) {
            JsonNode prim = value.get("prim");
            return prim.isNull() ? "None" : prim.asText();
        }
        if (value.has("ref")) {
            JsonNode obj = heap.path(value.get("ref").asText());
            String kind = obj.path("kind").asText("obj");
            String repr = obj.path("repr").asText("");
            return repr.isEmpty() ? kind : (kind + " " + repr);
        }
        return "?";
    }

    private static boolean isInteger(String s) {
        if (s.isEmpty()) {
            return false;
        }
        for (int i = 0; i < s.length(); i++) {
            if (!Character.isDigit(s.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    private static final String SYSTEM_PROMPT = """
            You explain code execution to a learner, one step at a time.
            You are given a program's source and a list of execution steps, each
            with an index, a line number, the event type, and the current local
            variables.

            For each step index provided, write ONE short present-tense sentence
            describing what that line does at that moment -- concrete and specific
            (mention the variable and value when it changes), never restating the
            syntax. Keep each under 18 words.

            Respond with ONLY a JSON object whose keys are the step index numbers
            (as strings) and whose values are the sentences. Include every index
            you were given and no others.
            """;
}
