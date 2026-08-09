/**
 * Snippet workspace.
 *
 * Runs real code against the tracer service and replays the result: code and
 * output on the left, call stack in the middle, heap on the right, transport
 * along the bottom. Everything below the toolbar is a pure function of
 * (trace, stepIndex).
 */

import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { CodePane } from "../components/CodePane";
import { HeapGraph } from "../components/HeapGraph";
import { NarrationStrip } from "../components/NarrationStrip";
import { OutputPane, OutputStatus } from "../components/OutputPane";
import { StackPane } from "../components/StackPane";
import { Timeline } from "../components/Timeline";
import { Button } from "../components/ui/Button";
import { Segmented, Select } from "../components/ui/Controls";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { Panel } from "../components/ui/Panel";
import { ApiError, fetchNarration, fetchServerInfo, fetchTraceById, runSnippet } from "../lib/api";
import { EXAMPLES } from "../lib/examples";
import { LANGUAGES } from "../lib/languages";
import { usePlayback } from "../store/playback";
import { usePrefs, type Language } from "../store/prefs";
import { titleFor, useRecents } from "../store/recents";
import { useCurrentStep } from "../store/selectors";
import { useSession } from "../store/session";
import type { TraceDocument } from "../types/trace";

/** Passed by the home page when reopening a recent run. */
interface RestoreState {
  language: Language;
  source: string;
  files: { name: string; content: string }[];
}

/** How long the share button stays in its "Copied" state before reverting. */
const COPIED_FEEDBACK_MS = 1600;

export function Snippet() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [packages, setPackages] = useState<Record<string, string[]>>({});
  const [languages, setLanguages] = useState<Record<string, boolean>>({ python: true });

  // The server's id for the trace on screen. Present only after a run that the
  // backend acknowledged, which is exactly when a link to it would resolve.
  const [traceId, setTraceId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    language, exampleId, source, files,
    init, pickExample, setLanguage, setSource, restore,
  } = useSession();

  const trace = usePlayback((s) => s.trace);
  const loadTrace = usePlayback((s) => s.loadTrace);
  const clearTrace = usePlayback((s) => s.clearTrace);
  const setNotes = usePlayback((s) => s.setNotes);
  const play = usePlayback((s) => s.play);
  const setSpeed = usePlayback((s) => s.setSpeed);
  const step = useCurrentStep();

  const autoplay = usePrefs((s) => s.autoplay);
  const narration = usePrefs((s) => s.narration);
  const record = useRecents((s) => s.record);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Preferences seed the workspace once per page load. Read imperatively:
  // changing the default language later must not yank the code you are editing.
  useEffect(() => {
    init();
    setSpeed(usePrefs.getState().defaultSpeed);
  }, [init, setSpeed]);

  // Reopened from the home page. Consumed once, then dropped from history so a
  // refresh does not resurrect an older snippet over the current one.
  useEffect(() => {
    const state = location.state as RestoreState | null;
    if (!state?.source) return;
    restore(state);
    clearTrace();
    setError(null);
    navigate("/app/snippet", { replace: true, state: null });
  }, [location.state, restore, clearTrace, navigate]);

  // Advisory: which libraries the sandbox image ships and which tracers are
  // reachable, shown before the first run.
  useEffect(() => {
    fetchServerInfo().then((info) => {
      if (!info) return;
      setPackages(info.packagesByLanguage);
      if (info.languages) setLanguages(info.languages);
    });
  }, []);

  // Opened from a shared link: `?t=<id>` names a trace someone already ran.
  //
  // The trace arrives without its source, because the id is a hash of the source
  // rather than a container for it -- so the replay is complete and the editor
  // is not. That is the honest outcome of content-addressing and better than the
  // alternative of putting somebody's code in a URL.
  const sharedId = searchParams.get("t");
  useEffect(() => {
    if (!sharedId) return;
    let cancelled = false;

    setRunning(true);
    fetchTraceById(sharedId)
      .then((doc) => {
        if (cancelled) return;
        if (!doc) {
          setError(
            "That shared trace is no longer available. It may have expired — run the code to build a new one.",
          );
          return;
        }
        loadTrace(doc);
        setTraceId(sharedId);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Something went wrong.");
        }
      })
      .finally(() => {
        if (!cancelled) setRunning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sharedId, loadTrace]);

  // Reverting the label is cosmetic, so it is fine to lose on unmount.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    if (!traceId) return;
    const url = `${window.location.origin}/app/snippet?t=${traceId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access is denied over plain http and in some browsers, so
      // fall back to putting the link in the address bar where it can at least
      // be copied by hand.
      setSearchParams({ t: traceId }, { replace: true });
    }
  };

  const pick = (id: string) => {
    pickExample(id);
    setError(null);
    clearTrace();
    setTraceId(null);
  };

  const switchLanguage = (lang: Language) => {
    setLanguage(lang);
    setError(null);
    clearTrace();
    setTraceId(null);
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const { doc, id } = await runSnippet({ language, source, files });
      loadTrace(doc);
      setTraceId(id ?? null);
      record({
        title: titleFor(source),
        language,
        source,
        files,
        status: doc.status,
        steps: doc.steps.length,
      });
      if (autoplay) play();
      if (narration) void narrate(doc); // fire-and-forget: already usable
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      clearTrace();
      setTraceId(null);
    } finally {
      setRunning(false);
    }
  };

  // Narration is best-effort. If the LLM is unconfigured or slow, the failure
  // is swallowed and the narration strip simply stays empty.
  const narrate = async (doc: TraceDocument) => {
    if (doc.status === "compile_error" || doc.steps.length === 0) return;
    setNarrating(true);
    try {
      setNotes(await fetchNarration(doc));
    } catch {
      /* narration is optional; ignore */
    } finally {
      setNarrating(false);
    }
  };

  // The loaded trace knows exactly what its own sandbox had; before the first
  // run, fall back to what health reported for this language.
  const shownPackages = trace?.meta?.packages ?? packages[language] ?? [];

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="flex h-bar shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="shrink-0 text-base font-medium text-ink">Code snippet</h1>
        <span className="h-4 w-px shrink-0 bg-border" />

        {/* A tracer that health-check reports as down stays visible but
            disabled, so its absence is legible rather than mysterious. */}
        <Segmented
          value={language}
          onChange={switchLanguage}
          options={LANGUAGES.map(({ value, label, name }) => ({
            value,
            label,
            disabled: languages[value] === false,
            title: languages[value] === false ? `The ${name} tracer is offline` : `Trace ${name}`,
          }))}
        />

        <Select
          value={exampleId ?? "custom"}
          onChange={(e) => pick(e.target.value)}
          title="Load a bundled example"
          size="sm"
          className="w-[168px]"
        >
          {exampleId === null && (
            <option value="custom" disabled>
              Custom snippet
            </option>
          )}
          {EXAMPLES[language].map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {files.length > 0 && (
            <span
              className="flex h-control-sm shrink-0 items-center gap-1.5 rounded-lg border border-border-soft
                         bg-surface-2 px-2.5 text-xs text-ink-dim"
              title={`Available to your code by name, e.g. pd.read_csv("${files[0].name}")`}
            >
              <Icon name="database" size={12} className="text-ink-faint" />
              <span className="font-mono">{files.map((f) => f.name).join(", ")}</span>
            </span>
          )}
          {shownPackages.length > 0 && (
            <span className="truncate font-mono text-xs text-ink-faint">
              {shownPackages.join(" · ")}
            </span>
          )}
          {/* Only offered once the server has given this trace an id, since
              that id is the entire link. */}
          {traceId && (
            <Button
              onClick={share}
              title="Copy a link that replays this exact trace"
              className="shrink-0"
            >
              <Icon name={copied ? "check" : "link"} size={14} />
              {copied ? "Copied" : "Share"}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={run}
            disabled={running || source.trim().length === 0}
          >
            <Icon name="play" size={14} filled />
            {running ? "Running…" : trace ? "Run again" : "Visualize"}
          </Button>
        </div>
      </header>

      {/*
        Column minimums are what keep a DataFrame card readable; below their
        sum the workspace scrolls sideways rather than crushing the panes.

        The outer inset is 16px, matching the toolbar above and the transport
        below -- at 12px the panel edges sat four pixels inside the header
        title and the scrubber, which is the kind of seam you see down the
        whole height of the screen once you have seen it. The gap between
        panes stays 12px: that one is density, not alignment.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,1fr)_minmax(220px,0.55fr)_minmax(340px,1.3fr)]
                      gap-3 overflow-x-auto p-4">
        <div className="grid min-h-0 grid-rows-[1.6fr_1fr] gap-3">
          <Panel
            title="Code"
            right={
              step ? (
                <span className="tnum font-mono text-xs text-accent">
                  line {step.line} · {step.event}
                </span>
              ) : (
                <span className="text-xs text-ink-faint">editable</span>
              )
            }
          >
            <CodePane
              value={source}
              onChange={setSource}
              language={language}
              // Locked during replay so the code on screen always matches the
              // trace being stepped through.
              readOnly={!!trace}
            />
          </Panel>

          <Panel title="Output" right={<OutputStatus />}>
            {error ? (
              <div className="p-4">
                <div className="rounded-lg border border-danger/40 bg-danger-soft p-3
                                font-mono text-xs leading-relaxed text-danger">
                  {error}
                </div>
              </div>
            ) : trace ? (
              <OutputPane />
            ) : (
              <EmptyState text="Press Visualize to trace every variable, object and reference as it changes." />
            )}
          </Panel>
        </div>

        <Panel title="Call stack">
          {trace ? (
            <StackPane />
          ) : (
            <EmptyState text="Frames and their variables appear here." />
          )}
        </Panel>

        <Panel
          title="Heap"
          right={
            trace && <span className="text-xs text-ink-faint">hover to trace references</span>
          }
        >
          {trace ? (
            <HeapGraph />
          ) : (
            <EmptyState text="Lists, dicts, instances and DataFrames appear here, with an arrow for every reference." />
          )}
        </Panel>
      </div>

      {trace && (
        <>
          <NarrationStrip loading={narrating} />
          <Timeline />
        </>
      )}
    </div>
  );
}
