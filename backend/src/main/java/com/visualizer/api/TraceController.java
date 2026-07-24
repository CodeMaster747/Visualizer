package com.visualizer.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizer.api.dto.RunRequest;
import com.visualizer.trace.TraceService;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api")
public class TraceController {

    private final TraceService traces;

    public TraceController(TraceService traces) {
        this.traces = traces;
    }

    /**
     * Run a snippet and return its trace document.
     *
     * The response is the tracer's document verbatim -- the frontend replayer
     * consumes exactly that shape whether it came from a cache hit, the Python
     * tracer, or the Java tracer.
     */
    @PostMapping("/trace")
    public ResponseEntity<JsonNode> trace(@Valid @RequestBody RunRequest req) {
        String language = req.languageOrDefault();
        if (!traces.supports(language)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Language '" + language + "' is not supported.");
        }
        return ResponseEntity.ok(traces.run(req));
    }
}
