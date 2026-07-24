/**
 * Account screen.
 *
 * The profile is real but local -- there is no account server in this build --
 * so this reports what is actually true rather than dressing up a remote user
 * record it does not have.
 */

import { Link } from "react-router-dom";

import { Page } from "../components/shell/Page";
import { Icon } from "../components/ui/Icon";
import { languageName } from "../lib/languages";
import { useAccount } from "../store/account";
import { usePrefs } from "../store/prefs";
import { useRecents } from "../store/recents";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-border-soft py-3.5 last:border-b-0">
      <span className="text-[13px] text-ink-dim">{label}</span>
      <span className="truncate text-[13px] text-ink">{value}</span>
    </div>
  );
}

export function Profile() {
  const defaultLanguage = usePrefs((s) => s.defaultLanguage);
  const runs = useRecents((s) => s.runs);
  const account = useAccount((s) => s.account);

  // The shell is gated, so this screen never renders signed out.
  if (!account) return null;

  return (
    <Page title="Profile" subtitle="Who this workspace belongs to." width="narrow">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full
                         border border-border bg-surface-2 text-[16px] font-medium text-ink-dim">
          {account.initials}
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-ink">{account.name}</div>
          <div className="mt-0.5 truncate text-[13px] text-ink-dim">{account.email}</div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          Workspace
        </h2>
        <div className="border-t border-border-soft">
          <Row label="Plan" value="Local — no account server" />
          <Row label="Default language" value={languageName(defaultLanguage)} />
          <Row label="Recent runs stored" value={`${runs.length} of 8`} />
          <Row label="Storage" value="This browser" />
        </div>
      </section>

      <p className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
        <Icon name="user" size={14} className="mt-px shrink-0" />
        <span>
          This profile exists only in this browser — there is no account server
          behind it, and no password was ever collected. Preferences and recent
          runs live in local storage; change them in{" "}
          <Link
            to="/app/settings"
            className="text-ink-dim underline decoration-border-strong underline-offset-2
                       transition-colors duration-150 hover:text-ink"
          >
            Settings
          </Link>
          .
        </span>
      </p>
    </Page>
  );
}
