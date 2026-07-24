/**
 * Codebase visualization -- phase two, not built yet.
 *
 * Deliberately an empty state and nothing else: a mocked-up repository tree
 * that does not respond to clicks is worse than an honest placeholder.
 */

import { Page } from "../components/shell/Page";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";

const PLANNED = [
  "Import a repository and see its modules and packages as a graph.",
  "Follow a call from entry point to implementation, across files.",
  "Step into any function and drop straight into the snippet replayer.",
];

export function Codebase() {
  return (
    <Page
      title="Codebase"
      subtitle="Map how a repository fits together, not just one file."
    >
      <div className="rounded-xl border border-border bg-surface p-8">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border
                        bg-surface-2 text-ink-dim">
          <Icon name="repo" size={18} />
        </div>
        <h2 className="mt-4 text-[15px] font-medium text-ink">Not available yet</h2>
        <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-ink-dim">
          Snippet tracing is complete for Python and Java. Whole-repository
          visualization is the next phase and is not part of this build.
        </p>

        <ul className="mt-6 border-t border-border-soft">
          {PLANNED.map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 border-b border-border-soft py-3
                         text-[13px] leading-relaxed text-ink-dim"
            >
              {/* A dot, not a tick: none of this is done yet. */}
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              {item}
            </li>
          ))}
        </ul>

        <Button className="mt-6" disabled title="Not available in this build">
          <Icon name="plus" size={14} />
          Connect a repository
        </Button>
      </div>
    </Page>
  );
}
