/**
 * TypeScript support: transpile, then map executed lines back to the source
 * the user actually wrote.
 *
 * Types are erased, never checked. A visualizer that refused to run code with
 * a type error would be refusing exactly the code someone wants to watch, and
 * the runtime behaviour -- which is what this tool shows -- does not depend on
 * the types anyway.
 */

import ts from "typescript";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode one base64 VLQ group into its signed integer fields. */
function decodeVlq(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = B64.indexOf(char);
    if (digit < 0) return values;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>= 1;
    values.push(negative ? -value : value);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * Build generated line -> original line (both 1-based).
 *
 * Only the first mapped segment of each generated line matters here: a step is
 * reported against a line, not a column, so the first thing on the line is the
 * right answer. Generated lines with no mapping at all (the `use strict`
 * preamble, helper functions the compiler injects) are absent from the map,
 * which is what tells the tracer to skip them.
 */
export function lineMapFrom(sourceMapText) {
  const map = new Map();
  let sourceLine = 0;
  const lines = JSON.parse(sourceMapText).mappings.split(";");
  lines.forEach((line, generatedIndex) => {
    let first = true;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const fields = decodeVlq(segment);
      if (fields.length < 4) continue;
      sourceLine += fields[2];
      if (first) {
        map.set(generatedIndex + 1, sourceLine + 1);
        first = false;
      }
    }
  });
  return map;
}

/**
 * Transpile TypeScript to runnable CommonJS.
 *
 * Returns the emitted JavaScript plus the line map, or a syntax diagnostic
 * with the position in the *original* source when the code will not parse.
 */
export function transpile(source) {
  const result = ts.transpileModule(source, {
    fileName: "main.ts",
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      inlineSourceMap: false,
      removeComments: false,
      // Emit decorators and class fields the way the runtime expects rather
      // than downlevelling them into helper functions with no line mapping.
      useDefineForClassFields: true,
    },
  });

  const fatal = (result.diagnostics ?? []).find(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  if (fatal) {
    const message = ts.flattenDiagnosticMessageText(fatal.messageText, " ");
    let line;
    if (fatal.file && typeof fatal.start === "number") {
      line = fatal.file.getLineAndCharacterOfPosition(fatal.start).line + 1;
    }
    return { error: { type: "SyntaxError", message, line } };
  }

  return {
    code: result.outputText,
    lineMap: lineMapFrom(result.sourceMapText),
  };
}
