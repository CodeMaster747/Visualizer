/**
 * A small centred confirmation dialog.
 *
 * Backdrop is a flat scrim rather than a blur, and the panel uses the same
 * border-and-surface treatment as everything else -- a modal should read as
 * the app pausing, not as a different app arriving.
 */

import { useEffect } from "react";

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
        className="w-full max-w-[380px] rounded-xl border border-border bg-surface p-6"
      >
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-8 rounded-lg px-3 text-[12px] font-medium text-ink-dim
                       transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="h-8 rounded-lg bg-accent px-3 text-[12px] font-medium text-on-accent
                       transition-colors duration-150 hover:bg-ink"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
