/**
 * A titled region of the workspace.
 *
 * Every pane in the visualizer is one of these, so their headers share a
 * baseline and their bodies share an inset. The body is deliberately padding-
 * free: panes scroll their own content and set their own inset, and a wrapper
 * with padding would clip the heap graph's edge measurements.
 */

interface Props {
  title: string;
  children: React.ReactNode;
  /** Metadata or controls, right-aligned in the header. */
  right?: React.ReactNode;
}

export function Panel({ title, children, right }: Props) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border-soft px-4">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          {title}
        </h2>
        {right}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
