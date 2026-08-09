/**
 * A small centred confirmation dialog.
 *
 * Backdrop is a flat scrim rather than a blur, and the panel uses the same
 * border-and-surface treatment as everything else -- a modal should read as
 * the app pausing, not as a different app arriving.
 */

import { useEffect } from "react";

import { Button } from "./Button";

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Dialog({ title, body, confirmLabel, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-6"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-[380px] p-6"
      >
        <h2 className="text-lg font-medium text-ink">{title}</h2>
        <p className="mt-2 text-base leading-relaxed text-ink-dim">{body}</p>
        {/* Both actions come from `Button`. Hand-rolling them here is how this
            dialog ended up with a second, brighter primary treatment than the
            rest of the app. */}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
