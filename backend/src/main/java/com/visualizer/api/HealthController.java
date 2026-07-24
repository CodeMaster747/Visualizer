package com.visualizer.api;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizer.config.AppProperties;
import com.visualizer.llm.NarrationService;
import com.visualizer.trace.TracerClient;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Aggregate health for the frontend.
 *
 * Surfaces which languages have a reachable tracer, which libraries each
 * sandbox ships, and whether narration is configured -- everything the UI needs
 * to decide what to show before the first run.
 *
 * Every configured tracer is probed, rather than a hardcoded list: adding a
 * language is a routing-table entry, and it would be a poor kind of pluggable
 * if health had to be taught about it separately.
 */
@RestController
@RequestMapping("/api")
public class HealthController {

    private final TracerClient tracer;
    private final NarrationService narration;
    private final AppProperties props;

    public HealthController(TracerClient tracer, NarrationService narration,
                            AppProperties props) {
        this.tracer = tracer;
        this.narration = narration;
        this.props = props;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        var out = new LinkedHashMap<String, Object>();
        out.put("status", "ok");
        out.put("narration", narration.enabled());

        var languages = new LinkedHashMap<String, Object>();
        var packagesByLanguage = new LinkedHashMap<String, Object>();
        String dataHint = "the current directory";

        // Several languages can share one service (JavaScript and TypeScript
        // do), so probe each distinct URL once.
        var probed = new HashMap<String, JsonNode>();
        for (var entry : props.tracers().urls().entrySet()) {
            String language = entry.getKey();
            JsonNode health = probed.computeIfAbsent(entry.getValue(),
                    url -> tracer.health(language));

            languages.put(language, health != null);
            if (health == null) {
                continue;
            }
            if (health.has("packages") && health.path("packages").size() > 0) {
                packagesByLanguage.put(language, health.path("packages"));
            }
            if (health.has("data_hint")) {
                dataHint = health.path("data_hint").asText(dataHint);
            }
        }

        out.put("languages", languages);
        out.put("packages_by_language", packagesByLanguage);
        // Kept for clients written against the single-language shape.
        out.put("packages", packagesByLanguage.getOrDefault("python",
                packagesByLanguage.values().stream().findFirst().orElse(null)));
        out.put("data_hint", dataHint);
        return out;
    }
}
