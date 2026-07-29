/**
 * Transport controls: scrubber, play/pause, stepping, speed, follow-variable.
 *
 * Scrubbing must stay smooth on a 5000-step trace, so the slider writes
 * straight to the store and every pane derives from that index -- no
 * intermediate debounce, no async work on the drag path.
 */

import { useEffect } from "react";

import { Icon, type IconName } from "./ui/Icon";
import { Select } from "./ui/Controls";
import { SPEEDS, usePlayback, type Speed } from "../store/playback";
import { changePointsFor } from "../lib/diff";

function Btn({
  onClick, disabled, title, icon, size = 15,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: IconName;
  size?: number;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim
                 transition-colors duration-150 hover:bg-surface-2 hover:text-ink
                 disabled:cursor-not-allowed disabled:opacity-30
                 disabled:hover:bg-transparent disabled:hover:text-ink-dim"
    >
      <Icon name={icon} size={size} filled />
    </button>
  );
}

export function Timeline() {
  const {
    trace, stepIndex, playing, speed, followVar,
    goTo, stepForward, stepBack, togglePlay, setSpeed,
    jumpToNextChange, jumpToPrevChange,
  } = usePlayback();

  const count = trace?.steps.length ?? 0;
  const atStart = stepIndex === 0;
  const atEnd = stepIndex >= count - 1;

  // Keyboard transport. Space/arrows are what people reach for instinctively.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Never steal keys from the editor or a text field.
      if (target.closest(".monaco-editor") || target.tagName === "INPUT") return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) jumpToNextChange();
        else stepForward();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) jumpToPrevChange();
        else stepBack();
      } else if (e.code === "Home") {
        goTo(0);
      } else if (e.code === "End") {
        goTo(count - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stepForward, stepBack, goTo, count, jumpToNextChange, jumpToPrevChange]);

  if (!trace) return null;

  // Tick marks showing where the followed variable changes -- turns the
  // scrubber into a map of "when does x move".
  const marks = followVar ? changePointsFor(trace.steps, followVar) : [];
  const progress = count > 1 ? (stepIndex / (count - 1)) * 100 : 0;

  return (
    <div className="flex h-14 shrink-0 items-center gap-4 border-t border-border bg-surface px-4">
      <div className="flex items-center gap-0.5">
        <Btn onClick={() => goTo(0)} disabled={atStart} title="Start (Home)" icon="skipStart" />
        <Btn onClick={stepBack} disabled={atStart} title="Back (←)" icon="stepBack" size={13} />
        <button
          onClick={togglePlay}
          disabled={count === 0}
          title="Play / pause (Space)"
          className="mx-1 flex h-8 w-9 items-center justify-center rounded-lg bg-accent
                     text-on-accent transition-colors duration-150 hover:bg-ink
                     disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          <Icon name={playing ? "pause" : "play"} size={14} filled />
        </button>
        <Btn onClick={stepForward} disabled={atEnd} title="Forward (→)" icon="stepForward" size={13} />
        <Btn onClick={() => goTo(count - 1)} disabled={atEnd} title="End (End)" icon="skipEnd" />
      </div>

      <div className="relative flex flex-1 items-center">
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={stepIndex}
          onChange={(e) => goTo(Number(e.target.value))}
          style={{ "--fill": `${progress}%` } as React.CSSProperties}
          className="viz-scrubber"
        />
        {marks.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2">
            {marks.map((m) => (
              <span
                key={m}
                className="absolute h-1 w-0.5 rounded-full bg-changed"
                style={{ left: `${count > 1 ? (m / (count - 1)) * 100 : 0}%` }}
              />
            ))}
          </div>
        )}
      </div>

      <span className="tnum w-20 shrink-0 text-right font-mono text-[11px] text-ink-dim">
        {count === 0 ? "—" : `${stepIndex + 1} / ${count}`}
      </span>

      <Select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        title="Playback speed"
        className="w-[76px] font-mono"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </Select>

      {followVar && (
        <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-changed/25
                        bg-changed-soft pl-2.5 pr-1">
          <Icon name="diamond" size={10} filled className="text-changed" />
          <span className="max-w-[96px] truncate font-mono text-[11px] text-changed">
            {followVar}
          </span>
          <button
            onClick={jumpToPrevChange}
            title="Previous change (Shift+←)"
            className="flex h-6 w-6 items-center justify-center rounded-md text-changed
                       transition-colors duration-150 hover:bg-changed/15"
          >
            <Icon name="chevronLeft" size={13} />
          </button>
          <button
            onClick={jumpToNextChange}
            title="Next change (Shift+→)"
            className="flex h-6 w-6 items-center justify-center rounded-md text-changed
                       transition-colors duration-150 hover:bg-changed/15"
          >
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
