package com.visualizer.tracerjava;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.stream.Stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * HTTP entry point for the Java tracer.
 *
 * Mirrors tracer-python's contract exactly -- POST /trace -> trace document,
 * GET /health -> status -- so the Spring Boot orchestrator treats the two
 * tracers identically. Uses the JDK's built-in HTTP server and a bounded thread
 * pool; each trace already forks its own debuggee JVM, so a handful of workers
 * is plenty.
 */
public final class Main {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int MAX_SOURCE = 200_000;

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8082"));
        // 0.0.0.0 is right under compose, where this is the only thing in its
        // container. Set BIND_HOST=127.0.0.1 when the tracer shares a container
        // with a public listener, so nothing but that listener is reachable.
        String host = System.getenv().getOrDefault("BIND_HOST", "0.0.0.0");
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/health", Main::handleHealth);
        server.createContext("/trace", Main::handleTrace);
        // Small pool: the expensive work is in forked debuggee JVMs, not here.
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.println("tracer-java listening on :" + port);
    }

    private static void handleHealth(HttpExchange ex) throws IOException {
        respond(ex, 200, Map.of(
                "status", "ok",
                "language", "java",
                "runtime_version", System.getProperty("java.version")));
    }

    private static void handleTrace(HttpExchange ex) throws IOException {
        if (!"POST".equals(ex.getRequestMethod())) {
            respond(ex, 405, Map.of("error", "method_not_allowed"));
            return;
        }

        JsonNode body;
        try {
            body = MAPPER.readTree(ex.getRequestBody());
        } catch (Exception e) {
            respond(ex, 400, Map.of("error", "invalid_json"));
            return;
        }

        String source = body.path("source").asText("");
        if (source.isBlank()) {
            respond(ex, 400, Map.of("error", "empty_source"));
            return;
        }
        if (source.length() > MAX_SOURCE) {
            respond(ex, 413, Map.of("error", "source_too_large"));
            return;
        }
        Limits limits = parseLimits(body.get("limits"));

        Path workDir = null;
        try {
            workDir = Files.createTempDirectory("viz-java-");
            Map<String, Object> doc = JdiTracer.trace(source, limits, workDir);
            respond(ex, 200, doc);
        } catch (Exception e) {
            respond(ex, 200, errorDocument(source, e));
        } finally {
            if (workDir != null) {
                deleteRecursively(workDir);
            }
        }
    }

    private static Limits parseLimits(JsonNode node) {
        if (node == null || !node.isObject()) {
            return Limits.defaults();
        }
        var raw = new java.util.HashMap<String, Integer>();
        node.fields().forEachRemaining(e -> {
            if (e.getValue().isInt()) {
                raw.put(e.getKey(), e.getValue().asInt());
            }
        });
        return Limits.clamp(raw);
    }

    /** A tracer crash still returns a valid, replayable (empty) document. */
    private static Map<String, Object> errorDocument(String source, Exception e) {
        return Map.of(
                "version", 1,
                "language", "java",
                "status", "error",
                "source", source,
                "steps", java.util.List.of(),
                "stdout", "",
                "error", Map.of(
                        "type", e.getClass().getSimpleName(),
                        "message", e.getMessage() == null ? "Tracer failure" : e.getMessage()));
    }

    private static void respond(HttpExchange ex, int status, Object body) throws IOException {
        byte[] payload = MAPPER.writeValueAsBytes(body);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(status, payload.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(payload);
        }
    }

    private static void deleteRecursively(Path dir) {
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignored) {
                    // best effort
                }
            });
        } catch (IOException ignored) {
            // best effort
        }
    }

    private Main() {}
}
