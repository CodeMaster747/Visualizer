/**
 * Account screen.
 *
 * The profile is real but local -- there is no account server in this build --
 * so this reports what is actually true rather than dressing up a remote user
 * record it does not have.
 */

import { Link } from "react-router-dom";

import { Page } from "../components/shell/Page";
import { Row } from "../components/ui/Controls";
import { Icon } from "../components/ui/Icon";
import { languageName } from "../lib/languages";
import { useAccount } from "../store/account";
import { usePrefs } from "../store/prefs";
import { useRecents } from "../store/recents";

export function Profile() {
  const defaultLanguage = usePrefs((s) => s.defaultLanguage);
  const runs = useRecents((s) => s.runs);
  const account = useAccount((s) => s.account);

  // The shell is gated, so this screen never renders signed out.
  if (!account) return null;

  return (
    <Page title="Profile" subtitle="Who this workspace belongs to." width="narrow">
      <div className="card flex items-center gap-4 p-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full
                         border border-border bg-surface-2 text-lg font-medium text-ink-dim">
          {account.initials}
        </span>
        <div className="min-w-0">
          <div className="text-lg font-medium text-ink">{account.name}</div>
          <div className="mt-1 truncate text-base text-ink-dim">{account.email}</div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="eyebrow mb-2 text-ink-faint">Workspace</h2>
        <div className="border-t border-border-soft">
          <Row label="Plan">Local — no account server</Row>
          <Row label="Default language">{languageName(defaultLanguage)}</Row>
          <Row label="Recent runs stored">{`${runs.length} of 8`}</Row>
          <Row label="Storage">This browser</Row>
        </div>
      </section>

      {/* 14px glyph in an 18px line box: (18 - 14) / 2 = 2. */}
      <p className="mt-6 flex items-start gap-2 text-sm leading-relaxed text-ink-faint">
        <Icon name="user" size={14} className="mt-[2px] shrink-0" />
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
