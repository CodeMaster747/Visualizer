/**
 * Primary navigation.
 *
 * Collapses to a 56px rail so the visualizer -- three columns of dense data --
 * can have the width back without the user losing their place in the app. The
 * icon column sits at the same x in both states, so collapsing reads as the
 * labels sliding away rather than the whole nav moving.
 *
 * That claim is load-bearing and was quietly false, so the arithmetic is
 * written down. Every glyph in this file centres at x = 28, which is also the
 * centre of the collapsed rail:
 *
 *     nav      px-2 (8)  + item px-3 (12) + 16px icon   -> 8 + 12 + 8  = 28
 *     account  p-2  (8)  + button px-2 (8) + 24px avatar -> 8 + 8 + 12 = 28
 *     header   pl-4 (16) + 24px mark                     -> 16 + 12    = 28
 *
 * The header used pl-3, putting the wordmark four pixels left of the column it
 * heads and off-centre in the collapsed rail.
 */

import { NavLink } from "react-router-dom";

import { AccountMenu } from "./AccountMenu";
import { Icon, type IconName } from "../ui/Icon";
import { usePrefs } from "../../store/prefs";

interface Item {
  to: string;
  label: string;
  icon: IconName;
}

const ITEMS: Item[] = [
  { to: "/app", label: "Home", icon: "home" },
  { to: "/app/snippet", label: "Code snippet", icon: "code" },
  { to: "/app/codebase", label: "Codebase", icon: "layers" },
];

function NavItem({ item, collapsed }: { item: Item; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/app"}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex h-control-md items-center gap-3 rounded-lg px-3 transition-colors duration-150 ${
          isActive
            ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
            : "text-ink-dim hover:bg-surface-2 hover:text-ink active:bg-surface-3"
        }`
      }
    >
      <Icon name={item.icon} className="shrink-0" />
      <span
        className={`truncate text-base transition-opacity duration-150 ${
          collapsed ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {item.label}
      </span>
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const toggleSidebar = usePrefs((s) => s.toggleSidebar);

  return (
    // Not clipped: the account popover has to escape the rail. Each region
    // below hides its own overflow instead.
    <aside
      className={`group/sidebar relative z-30 flex shrink-0 flex-col border-r border-border
                  bg-surface transition-[width] duration-200 ease-standard
                  ${collapsed ? "w-bar" : "w-60"}`}
    >
      {/* pl-4 puts the 24px mark's centre at x=28, on the icon column. pr-2
          matches the nav's own inset, so the collapse button lands on the
          same right margin as everything below it. */}
      <div className="flex h-bar shrink-0 items-center gap-3 overflow-hidden pl-4 pr-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent">
          <Icon name="box" size={14} />
        </div>
        <span
          className={`flex-1 truncate text-base font-semibold text-ink transition-opacity duration-150 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          Visualizer
        </span>
        <button
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-faint
                      transition-[background-color,color,opacity] duration-150
                      hover:bg-surface-2 hover:text-ink active:bg-surface-3
                      ${collapsed ? "hidden" : "opacity-0 group-hover/sidebar:opacity-100"}`}
        >
          <Icon name="sidebar" size={16} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-hidden px-2">
        <div
          className={`eyebrow px-3 pb-2 pt-2 text-ink-faint
                      transition-opacity duration-150 ${collapsed ? "opacity-0" : "opacity-100"}`}
        >
          Workspace
        </div>
        {ITEMS.map((item) => (
          <NavItem key={item.to} item={item} collapsed={collapsed} />
        ))}
        {collapsed && (
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            className="flex h-control-md items-center rounded-lg px-3 text-ink-faint
                       transition-colors duration-150 hover:bg-surface-2 hover:text-ink
                       active:bg-surface-3"
          >
            <Icon name="sidebar" className="shrink-0" />
          </button>
        )}
      </nav>

      <AccountMenu collapsed={collapsed} />
    </aside>
  );
}
