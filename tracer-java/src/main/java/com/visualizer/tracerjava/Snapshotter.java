package com.visualizer.tracerjava;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.sun.jdi.ArrayReference;
import com.sun.jdi.BooleanValue;
import com.sun.jdi.ByteValue;
import com.sun.jdi.CharValue;
import com.sun.jdi.ClassType;
import com.sun.jdi.DoubleValue;
import com.sun.jdi.Field;
import com.sun.jdi.FloatValue;
import com.sun.jdi.IntegerValue;
import com.sun.jdi.LongValue;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.ShortValue;
import com.sun.jdi.StringReference;
import com.sun.jdi.Value;

/**
 * Turns JDI {@link Value}s into the id-keyed heap graph of the trace format.
 *
 * Mirrors the Python snapshotter deliberately: identity-keyed objects (so
 * aliasing and cycles survive), bounded output with honest truncation, and rich
 * handling of the types learners actually use -- here that means arrays,
 * strings, boxed primitives, and common collections rather than numpy/pandas.
 */
public final class Snapshotter {

    private final Limits limits;
    /** uniqueID -> heap object map. Reserving an id before expanding breaks cycles. */
    private final Map<String, Map<String, Object>> heap = new LinkedHashMap<>();

    public Snapshotter(Limits limits) {
        this.limits = limits;
    }

    /** The heap accumulated so far. A fresh Snapshotter is used per step. */
    public Map<String, Map<String, Object>> heap() {
        return heap;
    }

    private static Map<String, Object> prim(Object value, String type) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("prim", value);
        m.put("prim_type", type);
        return m;
    }

    private static Map<String, Object> ref(String id) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ref", id);
        return m;
    }

    /** Encode a slot: primitives inline, everything else as a heap reference. */
    public Map<String, Object> encode(Value value) {
        return encode(value, 0);
    }

    private Map<String, Object> encode(Value value, int depth) {
        if (value == null) {
            return prim(null, "null");
        }
        if (value instanceof BooleanValue v) {
            return prim(v.value(), "bool");
        }
        if (value instanceof CharValue v) {
            return prim(String.valueOf(v.value()), "char");
        }
        if (value instanceof ByteValue v) {
            return prim((int) v.value(), "int");
        }
        if (value instanceof ShortValue v) {
            return prim((int) v.value(), "int");
        }
        if (value instanceof IntegerValue v) {
            return prim(v.value(), "int");
        }
        if (value instanceof LongValue v) {
            return prim(v.value(), "long");
        }
        if (value instanceof FloatValue v) {
            return numeric(v.value());
        }
        if (value instanceof DoubleValue v) {
            return numeric(v.value());
        }
        if (value instanceof StringReference v) {
            return truncatedString(v.value());
        }
        if (value instanceof ObjectReference obj) {
            return encodeObject(obj, depth);
        }
        return prim(value.toString(), "str");
    }

    private Map<String, Object> numeric(double d) {
        // NaN / infinities are not valid JSON numbers; send them as strings so
        // the whole document still parses.
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            return prim(Double.toString(d), "double");
        }
        return prim(d, "double");
    }

    private Map<String, Object> truncatedString(String s) {
        if (s.length() > limits.maxString()) {
            Map<String, Object> m = prim(s.substring(0, limits.maxString()), "str");
            m.put("truncated", true);
            return m;
        }
        return prim(s, "str");
    }

    private Map<String, Object> encodeObject(ObjectReference obj, int depth) {
        // Boxed primitives read far better unwrapped to their value.
        Map<String, Object> boxed = tryUnbox(obj);
        if (boxed != null) {
            return boxed;
        }

        String id = "o" + obj.uniqueID();
        if (!heap.containsKey(id)) {
            // Reserve BEFORE expanding so a cycle finds the id present and stops.
            heap.put(id, Map.of("kind", "pending"));
            heap.put(id, expand(obj, depth));
        }
        return ref(id);
    }

    private Map<String, Object> expand(ObjectReference obj, int depth) {
        if (depth > limits.maxDepth()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", "elided");
            m.put("repr", typeName(obj));
            m.put("truncated", true);
            return m;
        }
        try {
            if (obj instanceof ArrayReference arr) {
                return expandArray(arr, depth);
            }
            return expandInstance(obj, depth);
        } catch (RuntimeException e) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", "opaque");
            m.put("repr", "<" + typeName(obj) + ": snapshot failed>");
            return m;
        }
    }

    private Map<String, Object> expandArray(ArrayReference arr, int depth) {
        int total = arr.length();
        int shown = Math.min(total, limits.maxItems());
        List<Map<String, Object>> items = new ArrayList<>();
        List<Value> values = shown == 0 ? List.of() : arr.getValues(0, shown);
        for (Value v : values) {
            items.add(encode(v, depth + 1));
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", "list");
        m.put("items", items);
        m.put("total", total);
        m.put("truncated", total > shown);
        return m;
    }

    private Map<String, Object> expandInstance(ObjectReference obj, int depth) {
        ReferenceType rt = obj.referenceType();
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("kind", "instance");
        node.put("class", simpleName(rt.name()));

        List<String> order = new ArrayList<>();
        Map<String, Object> fields = new LinkedHashMap<>();
        int count = 0;
        for (Field f : rt.allFields()) {
            if (f.isStatic()) {
                continue; // statics belong to the class, not this instance
            }
            if (count++ >= limits.maxItems()) {
                node.put("truncated", true);
                break;
            }
            order.add(f.name());
            fields.put(f.name(), encode(obj.getValue(f), depth + 1));
        }
        node.put("fields", fields);
        node.put("field_order", order);
        node.put("methods", methodNames(rt));
        node.put("mro", superChain(rt));
        node.put("repr", simpleName(rt.name()));
        return node;
    }

    /** Unwrap java.lang boxed primitives to a plain value; null if not boxed. */
    private Map<String, Object> tryUnbox(ObjectReference obj) {
        String name = obj.referenceType().name();
        String prim = switch (name) {
            case "java.lang.Integer", "java.lang.Short", "java.lang.Byte" -> "int";
            case "java.lang.Long" -> "long";
            case "java.lang.Double", "java.lang.Float" -> "double";
            case "java.lang.Boolean" -> "bool";
            case "java.lang.Character" -> "char";
            default -> null;
        };
        if (prim == null) {
            return null;
        }
        Field valueField = obj.referenceType().fieldByName("value");
        if (valueField == null) {
            return null;
        }
        return encode(obj.getValue(valueField), 0);
    }

    private List<String> methodNames(ReferenceType rt) {
        List<String> names = new ArrayList<>();
        for (var m : rt.methods()) {
            if (m.isConstructor() || m.isStaticInitializer() || m.isSynthetic()) {
                continue;
            }
            if (m.declaringType().name().startsWith("java.")) {
                continue; // inherited Object methods are noise
            }
            names.add(m.name());
            if (names.size() >= limits.maxItems()) {
                break;
            }
        }
        return names;
    }

    private List<String> superChain(ReferenceType rt) {
        List<String> chain = new ArrayList<>();
        chain.add(simpleName(rt.name()));
        if (rt instanceof ClassType ct) {
            ClassType s = ct.superclass();
            while (s != null && chain.size() < 6) {
                chain.add(simpleName(s.name()));
                s = s.superclass();
            }
        }
        return chain;
    }

    private String typeName(ObjectReference obj) {
        try {
            return simpleName(obj.referenceType().name());
        } catch (RuntimeException e) {
            return "object";
        }
    }

    private static String simpleName(String fqn) {
        int dot = fqn.lastIndexOf('.');
        String name = dot < 0 ? fqn : fqn.substring(dot + 1);
        // Nested classes come through as "Outer$Inner"; show just "Inner", which
        // is how the learner refers to it in their source.
        int dollar = name.lastIndexOf('$');
        return dollar < 0 ? name : name.substring(dollar + 1);
    }
}
