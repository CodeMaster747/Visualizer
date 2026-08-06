package com.visualizer.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.visualizer.api.dto.RunRequest;
import com.visualizer.trace.TraceService;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api")
public class TraceController {

    /**
     * Carries the content-addressed id of the returned trace.
     *
     * A header rather than a field in the body, because the body is contractually
     * the tracer's document verbatim -- the frontend replayer parses that shape
     * and the JSON schema in `schema/` describes it. Adding an id inside would
     * make the API's response a different type from the thing it is supposed to
     * be passing through, and every tracer would have to learn about ids it has
     * no way to compute.
     */
    static final String TRACE_ID_HEADER = "X-Trace-Id";

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
        return ResponseEntity.ok()
                .header(TRACE_ID_HEADER, traces.idFor(req))
                .body(traces.run(req));
    }

    /**
     * Fetch an already-executed trace by its id. This is the read side of a
     * shared link.
     *
     * A miss is a plain 404 whether the id was never run, has aged out of an
     * in-memory-only deployment, or is simply malformed. Distinguishing those
     * would tell an anonymous caller which snippets other people have run, and
     * the id is a hash of the source -- so confirming one is confirming you can
     * guess someone's code.
     */
    @GetMapping("/trace/{id}")
    public ResponseEntity<JsonNode> byId(@PathVariable String id) {
        return traces.findById(id)
                .map(doc -> ResponseEntity.ok().header(TRACE_ID_HEADER, id).body(doc))
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "No stored trace for that link."));
    }
}
