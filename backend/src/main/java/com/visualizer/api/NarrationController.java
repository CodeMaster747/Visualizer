package com.visualizer.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizer.llm.NarrationService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class NarrationController {

    private final NarrationService narration;

    public NarrationController(NarrationService narration) {
        this.narration = narration;
    }

    /**
     * Narrate an already-run trace.
     *
     * Deliberately a separate call from /trace so the visualization renders
     * immediately and explanations arrive after. Always 200 with a (possibly
     * empty) notes map; narration being unavailable is a normal state, not an
     * error the client should have to handle.
     */
    @PostMapping("/narrate")
    public ResponseEntity<JsonNode> narrate(@RequestBody JsonNode trace) {
        return ResponseEntity.ok(narration.narrate(trace));
    }
}
