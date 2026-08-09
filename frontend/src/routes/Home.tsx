/**
 * Landing screen: the two things this product does, and what you did last.
 *
 * Codebase is not built yet and says so rather than being hidden -- an entry
 * point that exists and is honest about its state reads better than a feature
 * that appears one release later with no warning.
 */

import { useNavigate } from "react-router-dom";

import { Page } from "../components/shell/Page";
import { Icon, type IconName } from "../components/ui/Icon";
import { languageName } from "../lib/languages";
import { useAccount } from "../store/account";
import { relativeTime, useRecents } from "../store/recents";

const GREETINGS: [limit: number, text: string][] = [
  [5, "Working late"],
  [12, "Good morning"],
  [18, "Good afternoon"],
  [24, "Good evening"],
];

function greeting(): string {
  const hour = new Date().getHours();
  return GREETINGS.find(([limit]) => hour < limit)?.[1] ?? "Welcome";
}

function Entry({
  icon, title, description, badge, onClick,
}: {
  icon: IconName;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="card group flex flex-col items-start p-6 text-left
                 transition-colors duration-150 hover:border-border-strong hover:bg-surface-2
                 active:bg-surface-3"
    >
      <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border
                       bg-surface-2 text-ink-dim transition-colors duration-150
                       group-hover:border-border-strong group-hover:text-ink">
        <Icon name={icon} size={18} />
      </span>
      <span className="flex items-center gap-2">
        <span className="text-lg font-medium text-ink">{title}</span>
        {badge && (
          <span className="eyebrow rounded-md border border-border bg-surface-2 px-1.5 py-0.5
                           text-ink-faint">
            {badge}
          </span>
        )}
      </span>
      <span className="mt-2 text-base leading-relaxed text-ink-dim">{description}</span>
      {/* mt-auto, so the two cards' affordances sit on one line however many
          lines their descriptions run to. Without it the shorter card's "Open"
          floats 21px above its neighbour's. */}
      <span className="mt-auto flex items-center gap-1.5 pt-4 text-sm font-medium text-ink-faint
                       transition-colors duration-150 group-hover:text-ink">
        Open
        <Icon name="arrowRight" size={14} />
      </span>
    </button>
  );
}

export function Home() {
  const navigate = useNavigate();
  const runs = useRecents((s) => s.runs);
  const account = useAccount((s) => s.account);

  // First name only: "Good morning, Ada Lovelace" is a form letter.
  const firstName = account?.name.split(" ")[0];

  return (
    <Page
      title={firstName ? `${greeting()}, ${firstName}` : greeting()}
      subtitle="Watch code run, step by step."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Entry
          icon="code"
          title="Code snippet"
          description="Trace a single file of Python, Java, JavaScript or TypeScript. Every variable, object and reference, animated as it changes."
          onClick={() => navigate("/app/snippet")}
        />
        <Entry
          icon="layers"
          title="Codebase"
          description="Map how a whole repository fits together — modules, calls and dependencies."
          badge="Soon"
          onClick={() => navigate("/app/codebase")}
        />
      </div>

      {/* 32px between sections, the same gap Profile and Settings use. */}
      <section className="mt-8">
        <h2 className="eyebrow mb-2 text-ink-faint">Recent</h2>

        {runs.length === 0 ? (
          <p className="border-t border-border-soft py-4 text-sm text-ink-faint">
            Snippets you trace show up here, stored in this browser.
          </p>
        ) : (
          <ul className="border-t border-border-soft">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  onClick={() =>
                    navigate("/app/snippet", {
                      state: {
                        language: run.language,
                        source: run.source,
                        files: run.files,
                      },
                    })
                  }
                  className="flex h-11 w-full items-center gap-4 border-b border-border-soft px-2
                             text-left transition-colors duration-150 hover:bg-surface-2
                             active:bg-surface-3"
                >
                  <Icon name="file" size={14} className="shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink-dim">
                    {run.title}
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {languageName(run.language)}
                  </span>
                  <span className="tnum w-16 shrink-0 text-right text-xs text-ink-faint">
                    {run.steps} steps
                  </span>
                  <span className="tnum w-20 shrink-0 text-right text-xs text-ink-faint">
                    {relativeTime(run.at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
