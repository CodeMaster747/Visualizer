package com.visualizer.tracerjava;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the JDI tracer against the same scenario matrix as the Python
 * tracer, since both must produce the identical trace-v1 shape.
 *
 * These launch real debuggee JVMs, so they are slower than unit tests but are
 * the only way to prove the stepping and snapshotting actually work.
 */
class JdiTracerTest {

    @SuppressWarnings("unchecked")
    private Map<String, Object> trace(String source) throws Exception {
        Path dir = Files.createTempDirectory("viz-java-test-");
        try {
            return JdiTracer.trace(source, Limits.defaults(), dir);
        } finally {
            try (Stream<Path> walk = Files.walk(dir)) {
                walk.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            }
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> steps(Map<String, Object> doc) {
        return (List<Map<String, Object>>) doc.get("steps");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> lastGlobals(Map<String, Object> doc) {
        var steps = steps(doc);
        var frames = (List<Map<String, Object>>) steps.get(steps.size() - 1).get("frames");
        return (Map<String, Object>) frames.get(0).get("locals");
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> heapOf(Map<String, Object> step) {
        return (Map<String, Object>) step.get("heap");
    }

    private int primInt(Object value) {
        return ((Number) ((Map<String, Object>) value).get("prim")).intValue();
    }

    // --- core semantics ----------------------------------------------------

    @Test
    void wrapsBareStatementsAndTracesThem() throws Exception {
        Map<String, Object> doc = trace("int x = 5;\nint y = x + 2;\n");
        assertEquals("ok", doc.get("status"));
        assertEquals(5, primInt(lastGlobals(doc).get("x")));
        assertEquals(7, primInt(lastGlobals(doc).get("y")));
    }

    @Test
    void lineNumbersMapBackThroughTheWrapper() throws Exception {
        // The first user statement is line 1 despite the wrapper header.
        Map<String, Object> doc = trace("int x = 5;\n");
        int firstLine = ((Number) steps(doc).get(0).get("line")).intValue();
        assertEquals(1, firstLine);
    }

    @Test
    void recursionGivesEachInvocationItsOwnFrame() throws Exception {
        Map<String, Object> doc = trace("""
                public class Main {
                    static int fact(int n) {
                        if (n <= 1) return 1;
                        return n * fact(n - 1);
                    }
                    public static void main(String[] args) {
                        int result = fact(4);
                        System.out.println(result);
                    }
                }
                """);
        assertEquals("ok", doc.get("status"));

        Map<String, Object> deepest = steps(doc).stream()
                .max(Comparator.comparingInt(s -> ((List<?>) s.get("frames")).size()))
                .orElseThrow();
        var frames = (List<Map<String, Object>>) deepest.get("frames");
        assertEquals(5, frames.size(), "main + fact(4..1)");
        var ids = frames.stream().map(f -> (String) f.get("id")).distinct().count();
        assertEquals(5, ids, "each invocation must have a distinct frame id");
        assertEquals("24\n", doc.get("stdout"));
    }

    @Test
    void objectReferencesAreSharedByIdentity() throws Exception {
        Map<String, Object> doc = trace("""
                public class Main {
                    static class Node { int v; Node next; Node(int v){ this.v = v; } }
                    public static void main(String[] args) {
                        Node a = new Node(1);
                        Node b = a;
                        Node c = new Node(2);
                    }
                }
                """);
        Map<String, Object> locals = lastGlobals(doc);
        String aRef = (String) ((Map<String, Object>) locals.get("a")).get("ref");
        String bRef = (String) ((Map<String, Object>) locals.get("b")).get("ref");
        String cRef = (String) ((Map<String, Object>) locals.get("c")).get("ref");
        assertEquals(aRef, bRef, "a and b alias the same object");
        assertNotNull(cRef);
        assertFalse(aRef.equals(cRef), "c is a distinct object");
    }

    @Test
    void nestedClassNameIsShownSimply() throws Exception {
        Map<String, Object> doc = trace("""
                public class Main {
                    static class Node { int v; Node(int v){ this.v = v; } }
                    public static void main(String[] args) {
                        Node n = new Node(7);
                    }
                }
                """);
        Map<String, Object> heap = heapOf(steps(doc).get(steps(doc).size() - 1));
        boolean hasNode = heap.values().stream()
                .anyMatch(o -> "Node".equals(((Map<String, Object>) o).get("class")));
        assertTrue(hasNode, "nested class should display as 'Node', not 'Main$Node'");
    }

    @Test
    void arraysBecomeListObjects() throws Exception {
        Map<String, Object> doc = trace("int[] nums = {10, 20, 30};\n");
        Map<String, Object> heap = heapOf(steps(doc).get(steps(doc).size() - 1));
        Map<String, Object> arr = heap.values().stream()
                .map(o -> (Map<String, Object>) o)
                .filter(o -> "list".equals(o.get("kind")))
                .findFirst().orElseThrow();
        assertEquals(3, ((Number) arr.get("total")).intValue());
    }

    @Test
    void stringsAndBoxedTypesRenderAsPrimitives() throws Exception {
        Map<String, Object> doc = trace("String s = \"hi\";\nInteger boxed = 42;\n");
        Map<String, Object> locals = lastGlobals(doc);
        Map<String, Object> s = (Map<String, Object>) locals.get("s");
        Map<String, Object> boxed = (Map<String, Object>) locals.get("boxed");
        assertEquals("hi", s.get("prim"));
        assertEquals("str", s.get("prim_type"));
        assertEquals(42, ((Number) boxed.get("prim")).intValue());
    }

    // --- failure modes -----------------------------------------------------

    @Test
    void uncaughtExceptionIsReportedWithTypeAndLine() throws Exception {
        Map<String, Object> doc = trace("""
                public class Main {
                    public static void main(String[] args) {
                        int[] a = new int[2];
                        int x = a[5];
                    }
                }
                """);
        assertEquals("error", doc.get("status"));
        Map<String, Object> error = (Map<String, Object>) doc.get("error");
        assertEquals("ArrayIndexOutOfBoundsException", error.get("type"));
        assertEquals(4, ((Number) error.get("line")).intValue());
    }

    @Test
    void compileErrorProducesAValidEmptyTrace() throws Exception {
        Map<String, Object> doc = trace("int x = ;\n");
        assertEquals("compile_error", doc.get("status"));
        assertTrue(steps(doc).isEmpty());
        Map<String, Object> error = (Map<String, Object>) doc.get("error");
        assertEquals("CompileError", error.get("type"));
    }

    @Test
    void infiniteLoopTimesOutWithAPartialTrace() throws Exception {
        Path dir = Files.createTempDirectory("viz-java-test-");
        try {
            Limits fast = new Limits(1_000_000, 6, 100, 512, 1500);
            Map<String, Object> doc = JdiTracer.trace(
                    "while (true) { int x = 1; }\n", fast, dir);
            assertEquals("timeout", doc.get("status"));
        } finally {
            try (Stream<Path> walk = Files.walk(dir)) {
                walk.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            }
        }
    }

    @Test
    void stepBudgetTruncates() throws Exception {
        Path dir = Files.createTempDirectory("viz-java-test-");
        try {
            Limits tiny = new Limits(15, 6, 100, 512, 10_000);
            // A multi-line body: STEP_LINE is line-granular, so each iteration
            // must cross a new line to produce a step (single-line loops coalesce,
            // exactly like a debugger's line stepping).
            Map<String, Object> doc = JdiTracer.trace("""
                    for (int i = 0; i < 100; i++) {
                        int x = i;
                        int y = x + 1;
                    }
                    """, tiny, dir);
            assertEquals("truncated", doc.get("status"));
            assertEquals(15, steps(doc).size());
        } finally {
            try (Stream<Path> walk = Files.walk(dir)) {
                walk.sorted(Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
            }
        }
    }

    @Test
    void stdoutIsCapturedInOrder() throws Exception {
        Map<String, Object> doc = trace(
                "System.out.println(\"one\");\nSystem.out.println(\"two\");\n");
        assertEquals("one\ntwo\n", doc.get("stdout"));
    }

    @Test
    void everyRefResolvesWithinItsStep() throws Exception {
        Map<String, Object> doc = trace("""
                public class Main {
                    static class N { int v; N next; N(int v){ this.v = v; } }
                    public static void main(String[] args) {
                        N a = new N(1);
                        N b = new N(2);
                        a.next = b;
                        b.next = a;
                    }
                }
                """);
        for (Map<String, Object> step : steps(doc)) {
            Map<String, Object> heap = heapOf(step);
            var frames = (List<Map<String, Object>>) step.get("frames");
            for (Map<String, Object> frame : frames) {
                var locals = (Map<String, Object>) frame.get("locals");
                for (Object v : locals.values()) {
                    Object ref = ((Map<String, Object>) v).get("ref");
                    if (ref != null) {
                        assertTrue(heap.containsKey(ref),
                                "dangling ref " + ref + " in step " + step.get("i"));
                    }
                }
            }
        }
    }
}
