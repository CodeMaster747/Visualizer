/**
 * Account row at the foot of the sidebar, with its popover.
 *
 * "Sign out" ends the local session and nothing else: preferences and recent
 * runs belong to the browser rather than the profile, and a sign-out button
 * that silently wipes someone's settings is a surprising button. Because it
 * destroys nothing, it does not ask twice.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, type IconName } from "../ui/Icon";
import { useAccount } from "../../store/account";

interface Props {
  collapsed: boolean;
}

function MenuItem({
  icon, label, onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-control-sm w-full items-center gap-2 rounded-md px-2 text-sm text-ink-dim
                 transition-colors duration-150 hover:bg-surface-3 hover:text-ink
                 active:bg-surface-4"
    >
      <Icon name={icon} size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function AccountMenu({ collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const account = useAccount((s) => s.account);
  const signOut = useAccount((s) => s.signOut);

  // Click-outside and Escape, the two ways every popover is expected to close.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  // Back to the landing page: the shell is gated, so staying put would only
  // bounce through the guard to the same place.
  const logOut = () => {
    signOut();
    navigate("/", { replace: true });
  };

  // The shell does not render without an account; this is a type guard, not a
  // state the sidebar can actually be in.
  if (!account) return null;

  return (
    <div ref={containerRef} className="relative shrink-0 border-t border-border-soft p-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? account.name : undefined}
        className={`flex h-11 w-full items-center gap-3 rounded-lg px-2 text-left
                    transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3
                    ${open ? "bg-surface-2" : ""}`}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full
                     border border-border bg-surface-3 text-xs font-medium text-ink-dim"
        >
          {account.initials}
        </span>
        <span
          className={`min-w-0 flex-1 transition-opacity duration-150 ${
            collapsed ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <span className="block truncate text-sm font-medium text-ink">{account.name}</span>
          <span className="block truncate text-xs text-ink-faint">{account.email}</span>
        </span>
        {!collapsed && <Icon name="chevronUpDown" size={14} className="shrink-0 text-ink-faint" />}
      </button>

      {open && (
        <div
          className="absolute bottom-[calc(100%-4px)] left-2 z-40 w-56 rounded-lg
                     border border-border bg-surface-2 p-1"
        >
          <MenuItem icon="user" label="Profile" onClick={() => go("/app/profile")} />
          <MenuItem icon="settings" label="Settings" onClick={() => go("/app/settings")} />
          <div className="my-1 border-t border-border-soft" />
          <MenuItem icon="logout" label="Sign out" onClick={logOut} />
        </div>
      )}
    </div>
  );
}
