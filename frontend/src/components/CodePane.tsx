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

function defineTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "d8b4fe" },
      { token: "string", foreground: "a5e887" },
      { token: "number", foreground: "7dd3fc" },
    ],
    // Must track the tokens in index.css: the editor sits inside a panel and
    // any mismatch shows as a seam along the panel's inner edge.
    colors: {
      "editor.background": "#0f1116",
      "editor.foreground": "#f2f4f8",
      "editorLineNumber.foreground": "#3a3f4a",
      "editorLineNumber.activeForeground": "#8b909a",
      "editor.lineHighlightBackground": "#14171d",
      "editorGutter.background": "#0f1116",
      "editorIndentGuide.background1": "#1a1e26",
      "editorWidget.background": "#14171d",
      "editorWidget.border": "#242832",
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
          smoothScrolling: true,
          automaticLayout: true,
          overviewRulerLanes: 0,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}
