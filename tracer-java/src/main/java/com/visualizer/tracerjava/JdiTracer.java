package com.visualizer.tracerjava;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.sun.jdi.AbsentInformationException;
import com.sun.jdi.Bootstrap;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.Location;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.connect.LaunchingConnector;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.ExceptionEvent;
import com.sun.jdi.event.MethodEntryEvent;
import com.sun.jdi.event.MethodExitEvent;
import com.sun.jdi.event.StepEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.event.VMStartEvent;
import com.sun.jdi.request.EventRequestManager;
import com.sun.jdi.request.MethodEntryRequest;
import com.sun.jdi.request.MethodExitRequest;
import com.sun.jdi.request.StepRequest;

/**
 * Line-by-line Java tracer built on JDI (the Java Debug Interface).
 *
 * It launches the compiled snippet in a fresh debuggee JVM under debug control,
 * single-steps it, and snapshots the stack and heap at each line -- the Java
 * analogue of what sys.monitoring does for Python. The output is the identical
 * trace-v1 document, so the frontend replays a Java run with zero changes.
 *
 * The "don't step into libraries" principle carries over: class exclusion
 * filters keep the stepper out of the JDK, and only frames in user classes are
 * snapshotted. Everything else runs at full speed.
 */
public final class JdiTracer {

    private static final String[] JDK_EXCLUSIONS = {
            "java.*", "javax.*", "sun.*", "com.sun.*", "jdk.*", "kotlin.*"
    };

    private final String originalSource;
    private final UserProgram program;
    private final Limits limits;
    private final int lineOffset;
    private final java.util.Set<String> userClasses;

    private final List<Map<String, Object>> steps = new ArrayList<>();
    private final StringBuilder stdout = new StringBuilder();
    private final List<String> frameIdStack = new ArrayList<>();
    private int frameCounter = 0;

    private String status = "ok";
    private Map<String, Object> error;
    private long deadline;

    public JdiTracer(String originalSource, UserProgram program, Limits limits, int lineOffset) {
        this.originalSource = originalSource;
        this.program = program;
        this.limits = limits;
        this.lineOffset = lineOffset;
        this.userClasses = new java.util.HashSet<>(program.userClasses);
    }

    public Map<String, Object> run() {
        long start = System.currentTimeMillis();
        this.deadline = start + limits.timeoutMs();

        VirtualMachine vm = null;
        Process process = null;
        try {
            vm = launch();
            process = vm.process();
            pipe(process.getInputStream());
            pipe(process.getErrorStream());
            installRequests(vm);
            eventLoop(vm);
        } catch (VmTimeout t) {
            status = "timeout";
        } catch (StepBudget b) {
            status = "truncated";
        } catch (Exception e) {
            if ("ok".equals(status)) {
                status = "error";
                error = errorDoc(e.getClass().getSimpleName(),
                        e.getMessage() == null ? "Tracer error" : e.getMessage(), 1);
            }
        } finally {
            if (vm != null) {
                try {
                    vm.dispose();
                } catch (Exception ignored) {
                    // VM may already be dead.
                }
            }
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }

        return document(System.currentTimeMillis() - start);
    }

    // -- launch -------------------------------------------------------------

    private VirtualMachine launch() throws Exception {
        LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> args = connector.defaultArguments();
        args.get("main").setValue(program.mainClass);
        // Quote the classpath dir; it is a temp path but may contain spaces.
        args.get("options").setValue("-cp \"" + program.dir.toAbsolutePath() + "\"");
        return connector.launch(args);
    }

    private void installRequests(VirtualMachine vm) {
        EventRequestManager erm = vm.eventRequestManager();
        // Learn when user classes load so stepping can begin.
        var cpr = erm.createClassPrepareRequest();
        for (String c : userClasses) {
            cpr.addClassFilter(c);
        }
        cpr.enable();

        MethodEntryRequest entry = erm.createMethodEntryRequest();
        MethodExitRequest exit = erm.createMethodExitRequest();
        for (String ex : JDK_EXCLUSIONS) {
            entry.addClassExclusionFilter(ex);
            exit.addClassExclusionFilter(ex);
        }
        entry.enable();
        exit.enable();

        var exc = erm.createExceptionRequest(null, true, true);
        for (String ex : JDK_EXCLUSIONS) {
            exc.addClassExclusionFilter(ex);
        }
        exc.enable();
    }

    /** Begin single-stepping the given thread, excluding JDK internals. */
    private void startStepping(VirtualMachine vm, ThreadReference thread) {
        EventRequestManager erm = vm.eventRequestManager();
        // Avoid duplicate step requests if several user classes prepare.
        if (!erm.stepRequests().isEmpty()) {
            return;
        }
        StepRequest step = erm.createStepRequest(thread, StepRequest.STEP_LINE, StepRequest.STEP_INTO);
        for (String ex : JDK_EXCLUSIONS) {
            step.addClassExclusionFilter(ex);
        }
        step.enable();
    }

    // -- event loop ---------------------------------------------------------

    private void eventLoop(VirtualMachine vm) throws Exception {
        while (true) {
            long remaining = deadline - System.currentTimeMillis();
            if (remaining <= 0) {
                throw new VmTimeout();
            }
            EventSet set = vm.eventQueue().remove(remaining);
            if (set == null) {
                throw new VmTimeout(); // no event before the deadline
            }

            boolean disconnected = false;
            for (Event event : set) {
                if (event instanceof VMStartEvent || event instanceof ClassPrepareEvent) {
                    startStepping(vm, threadOf(event));
                } else if (event instanceof MethodEntryEvent me) {
                    onMethodEntry(me);
                } else if (event instanceof StepEvent se) {
                    onStep(se);
                } else if (event instanceof MethodExitEvent me) {
                    onMethodExit(me);
                } else if (event instanceof ExceptionEvent ee) {
                    onException(ee);
                } else if (event instanceof VMDisconnectEvent) {
                    disconnected = true;
                }
            }
            if (disconnected) {
                return;
            }
            set.resume();
        }
    }

    private ThreadReference threadOf(Event event) {
        if (event instanceof VMStartEvent e) {
            return e.thread();
        }
        if (event instanceof ClassPrepareEvent e) {
            return e.thread();
        }
        return null;
    }

    private void onMethodEntry(MethodEntryEvent event) {
        if (!isUserLocation(event.location())) {
            return;
        }
        String method = event.location().method().name();
        frameIdStack.add((method.equals("main") ? "main" : method) + "#" + (frameCounter++));
        // Record a "call" step for nested calls only; main's entry is the program
        // starting, which is noise -- the same choice the Python tracer makes for
        // the module frame.
        if (frameIdStack.size() > 1) {
            recordStep("call", event.thread(), event.location(), null);
        }
    }

    private void onStep(StepEvent event) {
        if (!isUserLocation(event.location())) {
            return;
        }
        recordStep("line", event.thread(), event.location(), null);
    }

    private void onMethodExit(MethodExitEvent event) {
        if (!isUserLocation(event.location())) {
            return;
        }
        // Record the return (with its value) BEFORE popping, so the returning
        // frame is still on the stack in the snapshot.
        if (frameIdStack.size() > 1) {
            recordStep("return", event.thread(), event.location(), event.returnValue());
        }
        if (!frameIdStack.isEmpty()) {
            frameIdStack.remove(frameIdStack.size() - 1);
        }
    }

    private void onException(ExceptionEvent event) {
        // Only terminal (uncaught) exceptions end the run; a caught exception is
        // ordinary control flow and would just add noise.
        if (event.catchLocation() != null) {
            return;
        }
        int line = userLine(event.thread());
        recordStep("exception", event.thread(), event.location(), null);
        status = "error";
        error = errorDoc(exceptionType(event.exception()),
                exceptionMessage(event.exception()), line);
    }

    // -- step recording -----------------------------------------------------

    private void recordStep(String eventType, ThreadReference thread, Location location,
                            Value returned) {
        if (steps.size() >= limits.maxSteps()) {
            throw new StepBudget();
        }
        List<StackFrame> jdiFrames;
        try {
            jdiFrames = thread.frames();
        } catch (Exception e) {
            return; // thread not suspended / gone
        }

        // User frames, innermost-first as JDI returns them.
        List<StackFrame> userFrames = new ArrayList<>();
        for (StackFrame f : jdiFrames) {
            if (isUserLocation(f.location())) {
                userFrames.add(f);
            }
        }
        if (userFrames.isEmpty()) {
            return;
        }
        reconcileFrameIds(userFrames.size());

        Snapshotter snapshotter = new Snapshotter(limits);
        List<Map<String, Object>> frames = new ArrayList<>();
        // Emit outermost-first (schema: index 0 is the outermost frame).
        for (int i = 0; i < userFrames.size(); i++) {
            StackFrame sf = userFrames.get(userFrames.size() - 1 - i);
            String id = i < frameIdStack.size() ? frameIdStack.get(i) : "frame#" + (frameCounter++);
            frames.add(buildFrame(id, sf, snapshotter, i == 0));
        }

        Map<String, Object> step = new LinkedHashMap<>();
        step.put("i", steps.size());
        step.put("line", mapLine(location.lineNumber()));
        step.put("event", eventType);
        step.put("stdout_len", stdoutLength());
        step.put("frames", frames);
        step.put("heap", snapshotter.heap());
        if (returned != null) {
            step.put("returned", snapshotter.encode(returned));
        }
        steps.add(step);
    }

    private Map<String, Object> buildFrame(String id, StackFrame sf, Snapshotter snap,
                                           boolean isOutermost) {
        Location loc = sf.location();
        String method = loc.method().name();

        Map<String, Object> locals = new LinkedHashMap<>();
        List<String> order = new ArrayList<>();
        try {
            for (LocalVariable lv : sf.visibleVariables()) {
                if (order.size() >= limits.maxItems()) {
                    break;
                }
                // main's String[] args is always the empty launch arguments here
                // -- noise that would otherwise sit at the top of the global frame.
                if (isOutermost && method.equals("main") && lv.name().equals("args")) {
                    continue;
                }
                order.add(lv.name());
                locals.put(lv.name(), snap.encode(sf.getValue(lv)));
            }
        } catch (AbsentInformationException ignored) {
            // Compiled without -g; should not happen since we force it.
        }

        Map<String, Object> frame = new LinkedHashMap<>();
        frame.put("id", id);
        frame.put("name", method);
        frame.put("line", mapLine(loc.lineNumber()));
        frame.put("locals", locals);
        frame.put("order", order);
        frame.put("is_global", method.equals("main"));
        return frame;
    }

    /** Keep the id stack the same size as the live user-frame count. */
    private void reconcileFrameIds(int depth) {
        while (frameIdStack.size() > depth) {
            frameIdStack.remove(frameIdStack.size() - 1);
        }
        while (frameIdStack.size() < depth) {
            frameIdStack.add("frame#" + (frameCounter++));
        }
    }

    // -- helpers ------------------------------------------------------------

    private boolean isUserLocation(Location location) {
        try {
            return isUserType(location.declaringType());
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isUserType(ReferenceType type) {
        String name = type.name();
        int dollar = name.indexOf('$');
        String top = dollar < 0 ? name : name.substring(0, dollar);
        return userClasses.contains(top);
    }

    private int userLine(ThreadReference thread) {
        try {
            for (StackFrame f : thread.frames()) {
                if (isUserLocation(f.location())) {
                    return mapLine(f.location().lineNumber());
                }
            }
        } catch (Exception ignored) {
            // fall through
        }
        return 1;
    }

    /** Translate a debuggee line number back to the user's source. */
    private int mapLine(int line) {
        return Math.max(1, line - lineOffset);
    }

    private String exceptionType(ObjectReference exc) {
        String name = exc.referenceType().name();
        int dot = name.lastIndexOf('.');
        return dot < 0 ? name : name.substring(dot + 1);
    }

    private String exceptionMessage(ObjectReference exc) {
        try {
            var field = exc.referenceType().fieldByName("detailMessage");
            if (field != null) {
                Value v = exc.getValue(field);
                if (v instanceof StringReference s) {
                    return s.value();
                }
            }
        } catch (Exception ignored) {
            // no message available
        }
        return "";
    }

    private Map<String, Object> errorDoc(String type, String message, int line) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("type", type);
        e.put("message", message == null ? "" : truncate(message));
        e.put("line", line);
        return e;
    }

    private String truncate(String s) {
        return s.length() > limits.maxString() ? s.substring(0, limits.maxString()) : s;
    }

    // -- stdout capture -----------------------------------------------------

    private synchronized int stdoutLength() {
        return stdout.length();
    }

    private void pipe(InputStream in) {
        Thread t = new Thread(() -> {
            byte[] buf = new byte[4096];
            int n;
            try {
                while ((n = in.read(buf)) != -1) {
                    String chunk = new String(buf, 0, n, StandardCharsets.UTF_8);
                    synchronized (this) {
                        // Bound total captured output so a print-heavy loop cannot
                        // exhaust memory.
                        if (stdout.length() < 1_000_000) {
                            stdout.append(chunk);
                        }
                    }
                }
            } catch (IOException ignored) {
                // process ended
            }
        });
        t.setDaemon(true);
        t.start();
    }

    // -- output -------------------------------------------------------------

    private Map<String, Object> document(long durationMs) {
        // Give the pipe threads a beat to flush the last of the debuggee's output.
        try {
            Thread.sleep(30);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("version", 1);
        doc.put("language", "java");
        doc.put("status", status);
        doc.put("source", originalSource);
        doc.put("steps", steps);
        synchronized (this) {
            doc.put("stdout", stdout.toString());
        }
        doc.put("limits", limits.asMap());

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("step_count", steps.size());
        meta.put("duration_ms", durationMs);
        meta.put("runtime_version", System.getProperty("java.version"));
        // How Java spells these. The replayer must never branch on `language`,
        // and "null" vs "None" is the one place where rendering a value depends
        // on where it came from.
        meta.put("literals", Map.of("null", "null", "true", "true", "false", "false"));
        doc.put("meta", meta);

        if (error != null) {
            doc.put("error", error);
        }
        return doc;
    }

    // -- control-flow signals ----------------------------------------------

    private static final class VmTimeout extends RuntimeException {}

    private static final class StepBudget extends RuntimeException {}

    /** Compile then trace a snippet end-to-end. */
    public static Map<String, Object> trace(String source, Limits limits, Path workDir)
            throws IOException {
        UserProgram program;
        try {
            program = UserProgram.compile(source, workDir);
        } catch (UserProgram.CompileError ce) {
            return compileErrorDoc(source, ce, limits);
        }
        return new JdiTracer(source, program, limits, program.lineOffset).run();
    }

    private static Map<String, Object> compileErrorDoc(String source, UserProgram.CompileError ce,
                                                       Limits limits) {
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("version", 1);
        doc.put("language", "java");
        doc.put("status", "compile_error");
        doc.put("source", source);
        doc.put("steps", List.of());
        doc.put("stdout", "");
        doc.put("limits", limits.asMap());
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "CompileError");
        error.put("message", ce.getMessage());
        error.put("line", ce.line);
        doc.put("error", error);
        return doc;
    }
}
