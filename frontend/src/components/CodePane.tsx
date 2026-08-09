/**
 * Monaco editor with the executing line highlighted.
 *
 * Doubles as the input surface: editable when idle, read-only while a trace is
 * loaded, so the code on screen always matches the trace being replayed.
 */

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { editor } from "monaco-editor";

import { usePlayback } from "../store/playback";
import { useCurrentStep } from "../store/selectors";

const THEME = "visualizer-dark";

/**
 * A monochrome syntax theme.
 *
 * `inherit` is off on purpose: inheriting vs-dark leaves every token this list
 * does not name -- functions, types, operators -- painted in the base theme's
 * colours, and the editor is the largest surface in the app, so that leakage
 * is what a rainbow in the middle of a grey interface looks like.
 *
 * Highlighting is done in weight instead. Keywords are the brightest because
 * they carry the structure; literals sit just below them because they are the
 * values the reader is here to watch; punctuation and comments recede.
 */
function defineTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: false,
    rules: [
      { token: "", foreground: "b6bac2" },
      // Tracks the app's tertiary floor: `ink-faint` composites to roughly
      // #747679 over this background, and a comment materially darker than
      // that is the one piece of text in the app still failing the contrast
      // the rest of the palette was raised to meet.
      { token: "comment", foreground: "6b7079", fontStyle: "italic" },
      { token: "keyword", foreground: "f4f5f7" },
      { token: "keyword.control", foreground: "f4f5f7" },
      { token: "string", foreground: "d2d6dd" },
      { token: "string.escape", foreground: "eceef1" },
      { token: "number", foreground: "f4f5f7" },
      { token: "regexp", foreground: "d2d6dd" },
      { token: "constant", foreground: "eceef1" },
      { token: "type", foreground: "e4e7ec" },
      { token: "type.identifier", foreground: "e4e7ec" },
      { token: "identifier", foreground: "b6bac2" },
      { token: "variable", foreground: "b6bac2" },
      { token: "function", foreground: "e4e7ec" },
      { token: "tag", foreground: "e4e7ec" },
      { token: "attribute.name", foreground: "b6bac2" },
      { token: "delimiter", foreground: "868c96" },
      { token: "operator", foreground: "868c96" },
      { token: "annotation", foreground: "868c96" },
      { token: "invalid", foreground: "e0736f" },
    ],
    // Must track the tokens in index.css: the editor sits inside a panel and
    // any mismatch shows as a seam along the panel's inner edge.
    colors: {
      "editor.background": "#0d0f13",
      "editor.foreground": "#edeef1",
      "editorCursor.foreground": "#ccd2de",
      // The gutter is the largest run of small text in the app; at #363b44 it
      // was under 2:1. Inactive sits a step below comments, active a step
      // above, so the executing line's number is findable at a glance.
      "editorLineNumber.foreground": "#4f545e",
      "editorLineNumber.activeForeground": "#a0a5ad",
      "editor.lineHighlightBackground": "#131519",
      "editor.selectionBackground": "#2a2e36",
      "editor.inactiveSelectionBackground": "#1f232a",
      "editorGutter.background": "#0d0f13",
      "editorIndentGuide.background1": "#191c22",
      "editorIndentGuide.activeBackground1": "#22252c",
      "editorWidget.background": "#131519",
      "editorWidget.border": "#22252c",
      "editorSuggestWidget.selectedBackground": "#22252c",
      // Bracket matching stays, as a hairline rather than a fill.
      "editorBracketMatch.background": "#00000000",
      "editorBracketMatch.border": "#4a505b",
      // Every nesting depth gets the same grey as any other delimiter. The
      // editor option above asks for this too, but the colours are what the
      // renderer actually reads, so they are set here as well.
      "editorBracketHighlight.foreground1": "#868c96",
      "editorBracketHighlight.foreground2": "#868c96",
      "editorBracketHighlight.foreground3": "#868c96",
      "editorBracketHighlight.foreground4": "#868c96",
      "editorBracketHighlight.foreground5": "#868c96",
      "editorBracketHighlight.foreground6": "#868c96",
      "editorBracketHighlight.unexpectedBracket.foreground": "#e0736f",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
      "scrollbarSlider.activeBackground": "#ffffff2e",
    },
  });
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: string;
  readOnly: boolean;
}

export function CodePane({ value, onChange, language, readOnly }: Props) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  const step = useCurrentStep();
  const trace = usePlayback((s) => s.trace);

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    defineTheme(monaco);
    monaco.editor.setTheme(THEME);
    decorationsRef.current = ed.createDecorationsCollection();
  };

  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    const decorations = decorationsRef.current;
    if (!ed || !monaco || !decorations) return;

    if (!step) {
      decorations.clear();
      return;
    }

    const isError = step.event === "exception";
    decorations.set([
      {
        range: new monaco.Range(step.line, 1, step.line, 1),
        options: {
          isWholeLine: true,
          className: isError ? "viz-error-line" : "viz-current-line",
        },
      },
    ]);

    // Keep the active line in view during playback, but centre only when it
    // has actually left the viewport -- constant re-centring is nauseating.
    ed.revealLineInCenterIfOutsideViewport(step.line);
  }, [step, trace]);

  return (
    <div className="h-full">
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          readOnly,
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "none",
          // Monaco tints nested bracket pairs from its own rainbow, which is
          // independent of the token theme and was the last colour left in the
          // editor. Nesting depth is not what this tool is here to show.
          bracketPairColorization: { enabled: false },
          smoothScrolling: true,
          automaticLayout: true,
          overviewRulerLanes: 0,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}
