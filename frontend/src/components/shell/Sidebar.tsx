/**
 * Primary navigation.
 *
 * Collapses to a 56px rail so the visualizer -- three columns of dense data --
 * can have the width back without the user losing their place in the app. The
 * icon column sits at the same x in both states, so collapsing reads as the
 * labels sliding away rather than the whole nav moving.
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
        `flex h-9 items-center gap-3 rounded-lg px-3 transition-colors duration-150 ${
          isActive
            ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--color-border-soft)]"
            : "text-ink-dim hover:bg-surface-2/60 hover:text-ink"
        }`
      }
    >
      <Icon name={item.icon} className="shrink-0" />
      <span
        className={`truncate text-[13px] transition-opacity duration-150 ${
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
                  bg-surface transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]
                  ${collapsed ? "w-14" : "w-60"}`}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden px-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-on-accent">
          <Icon name="box" size={14} />
        </div>
        <span
          className={`flex-1 truncate text-[13px] font-semibold text-ink transition-opacity duration-150 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          Visualizer
        </span>
        <button
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint
                      transition-[background-color,color,opacity] duration-150
                      hover:bg-surface-2 hover:text-ink
                      ${collapsed ? "hidden" : "opacity-0 group-hover/sidebar:opacity-100"}`}
        >
          <Icon name="sidebar" size={15} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-hidden px-2">
        <div
          className={`px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint
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
            className="mt-1 flex h-9 items-center rounded-lg px-3 text-ink-faint
                       transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            <Icon name="sidebar" className="shrink-0" />
          </button>
        )}
      </nav>

      <AccountMenu collapsed={collapsed} />
    </aside>
  );
}
