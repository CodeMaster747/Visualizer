package com.visualizer.tracerjava;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * Compiles a user snippet to a temp directory and records what to run.
 *
 * A bare snippet (no class declaration) is wrapped in a `Main` class so that
 * learners can paste statements without the ceremony, matching how the Python
 * side accepts a bare script. The set of compiled class names is captured so
 * the tracer can restrict stepping to user code, exactly as the Python tracer
 * filters on the snippet's filename.
 */
public final class UserProgram {

    private static final Pattern PUBLIC_CLASS =
            Pattern.compile("public\\s+(?:final\\s+|abstract\\s+)?class\\s+(\\w+)");
    private static final Pattern ANY_CLASS = Pattern.compile("\\bclass\\s+(\\w+)");

    public final Path dir;
    public final String mainClass;
    /** Simple names of every top-level class the user defined. */
    public final List<String> userClasses;
    /** Lines the wrapper prepended, so trace line numbers map back to the user's
     *  source. Zero when the user wrote their own class. */
    public final int lineOffset;

    private UserProgram(Path dir, String mainClass, List<String> userClasses, int lineOffset) {
        this.dir = dir;
        this.mainClass = mainClass;
        this.userClasses = userClasses;
        this.lineOffset = lineOffset;
    }

    /** A compilation failure, shaped like the trace document's error field. */
    public static final class CompileError extends Exception {
        public final int line;
        public CompileError(String message, int line) {
            super(message);
            this.line = line;
        }
    }

    public static UserProgram compile(String source, Path dir) throws CompileError, IOException {
        String className;
        String finalSource;
        int lineOffset;

        Matcher pub = PUBLIC_CLASS.matcher(source);
        Matcher any = ANY_CLASS.matcher(source);
        if (pub.find()) {
            // A public class dictates the filename; run it.
            className = pub.group(1);
            finalSource = source;
            lineOffset = 0;
        } else if (any.find() && source.contains("main(")) {
            // Full program without a public class -- filename is free.
            className = any.group(1);
            finalSource = source;
            lineOffset = 0;
        } else {
            // Bare statements: wrap them so `int x = 1; System.out.println(x);`
            // just works.
            className = "Main";
            finalSource = wrap(source);
            lineOffset = WRAP_HEADER_LINES;
        }

        Path srcFile = dir.resolve(className + ".java");
        Files.writeString(srcFile, finalSource, StandardCharsets.UTF_8);

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("No system Java compiler; run on a JDK, not a JRE.");
        }
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        try (StandardJavaFileManager fm =
                     compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
            fm.setLocation(javax.tools.StandardLocation.CLASS_OUTPUT, List.of(dir.toFile()));
            var units = fm.getJavaFileObjects(srcFile.toFile());
            // -g is REQUIRED: without the LocalVariableTable, JDI cannot read
            // local variables and every frame would show no variables at all.
            var options = List.of("-g");
            boolean ok = compiler.getTask(null, fm, diagnostics, options, null, units).call();
            if (!ok) {
                throw firstError(diagnostics, lineOffset);
            }
        }

        return new UserProgram(dir, className, collectClasses(dir), lineOffset);
    }

    private static CompileError firstError(DiagnosticCollector<JavaFileObject> diagnostics,
                                           int headerOffset) {
        for (Diagnostic<? extends JavaFileObject> d : diagnostics.getDiagnostics()) {
            if (d.getKind() == Diagnostic.Kind.ERROR) {
                long line = d.getLineNumber();
                int reported = line == Diagnostic.NOPOS ? 1 : (int) Math.max(1, line - headerOffset);
                return new CompileError(d.getMessage(Locale.ROOT), reported);
            }
        }
        return new CompileError("Compilation failed.", 1);
    }

    private static List<String> collectClasses(Path dir) {
        List<String> names = new ArrayList<>();
        File[] files = dir.toFile().listFiles((d, name) -> name.endsWith(".class"));
        if (files != null) {
            for (File f : files) {
                String name = f.getName().substring(0, f.getName().length() - ".class".length());
                // Only top-level classes; nested types (Foo$Bar) are matched by
                // prefix when filtering steps.
                if (!name.contains("$")) {
                    names.add(name);
                }
            }
        }
        return names;
    }

    // Kept in sync with wrap(): the two header lines before the user's first line
    // ("public class Main {" and "    public static void main(...) {").
    private static final int WRAP_HEADER_LINES = 2;

    private static String wrap(String source) {
        return """
                public class Main {
                    public static void main(String[] args) throws Exception {
                """
                + source.stripTrailing() + "\n"
                + "    }\n}\n";
    }
}
