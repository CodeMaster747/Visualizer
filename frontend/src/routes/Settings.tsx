/**
 * Preferences.
 *
 * Every switch here maps to exactly one behaviour elsewhere in the app -- no
 * settings that do nothing. All of it is local to this browser.
 */

import { Page } from "../components/shell/Page";
import { Button } from "../components/ui/Button";
import { SettingGroup, SettingRow, Select, Toggle } from "../components/ui/Controls";
import { SPEEDS, type Speed } from "../store/playback";
import { usePrefs, type Language } from "../store/prefs";
import { useRecents } from "../store/recents";

export function Settings() {
  const prefs = usePrefs();
  const runs = useRecents((s) => s.runs);
  const clearRecents = useRecents((s) => s.clear);

  return (
    <Page
      title="Settings"
      subtitle="Preferences for this browser."
      width="narrow"
    >
      <SettingGroup title="Appearance">
        <SettingRow
          label="Collapsed sidebar"
          description="Show navigation as an icon rail to give the workspace more width."
        >
          <Toggle
            checked={prefs.sidebarCollapsed}
            onChange={(v) => prefs.set("sidebarCollapsed", v)}
            label="Collapsed sidebar"
          />
        </SettingRow>
        <SettingRow
          label="Reduce motion"
          description="Cut animations to instant transitions, whatever the system setting says."
        >
          <Toggle
            checked={prefs.reducedMotion}
            onChange={(v) => prefs.set("reducedMotion", v)}
            label="Reduce motion"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Playback">
        <SettingRow
          label="Default speed"
          description="Rate a freshly loaded trace starts at."
        >
          <Select
            value={prefs.defaultSpeed}
            onChange={(e) => prefs.set("defaultSpeed", Number(e.target.value) as Speed)}
            className="w-24"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </Select>
        </SettingRow>
        <SettingRow
          label="Play on load"
          description="Start stepping as soon as a run finishes, instead of waiting at step one."
        >
          <Toggle
            checked={prefs.autoplay}
            onChange={(v) => prefs.set("autoplay", v)}
            label="Play on load"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Execution">
        <SettingRow
          label="Default language"
          description="Language a new snippet session opens in."
        >
          <Select
            value={prefs.defaultLanguage}
            onChange={(e) => prefs.set("defaultLanguage", e.target.value as Language)}
            className="w-36"
          >
            <option value="python">Python</option>
            <option value="java">Java</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
          </Select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="AI">
        <SettingRow
          label="Step narration"
          description="Explain each step in plain English after a run. Optional — the visualization works without it."
        >
          <Toggle
            checked={prefs.narration}
            onChange={(v) => prefs.set("narration", v)}
            label="Step narration"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Data">
        <SettingRow
          label="Recent runs"
          description={`${runs.length} snippet${runs.length === 1 ? "" : "s"} stored in this browser.`}
        >
          <Button onClick={clearRecents} disabled={runs.length === 0}>
            Clear
          </Button>
        </SettingRow>
      </SettingGroup>
    </Page>
  );
}
