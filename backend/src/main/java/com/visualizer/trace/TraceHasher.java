package com.visualizer.trace;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.visualizer.api.dto.RunRequest;

import org.springframework.stereotype.Component;

/**
 * Content-addressing for runs.
 *
 * A trace is a deterministic function of its inputs, so the hash of those inputs
 * is a stable cache key and also a natural id for shareable permalinks later.
 * Everything that affects the output goes into the hash; nothing that does not
 * (e.g. request timing) does.
 */
@Component
public class TraceHasher {

    private final ObjectMapper mapper;

    public TraceHasher(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String hash(String language, RunRequest req) {
        // Canonicalise through a fixed field order so equivalent requests hash
        // identically regardless of incoming JSON key order.
        var canonical = new java.util.LinkedHashMap<String, Object>();
        canonical.put("language", language);
        canonical.put("source", req.source());
        canonical.put("stdin", req.stdin() == null ? "" : req.stdin());
        canonical.put("files", req.files() == null ? java.util.List.of() : req.files());
        canonical.put("limits", req.limits() == null ? java.util.Map.of() : req.limits());

        try {
            byte[] bytes = mapper.writeValueAsBytes(canonical);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException e) {
            // SHA-256 is always present and the map is always serialisable; this
            // is unreachable in practice.
            throw new IllegalStateException("Failed to hash run request", e);
        }
    }

    /** Hash of a trace document itself, for keying its narration. */
    public String hashTrace(byte[] traceBytes) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(traceBytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public String hashString(String value) {
        return hashTrace(value.getBytes(StandardCharsets.UTF_8));
    }
}
