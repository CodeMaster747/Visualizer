/**
 * Form controls: segmented switch, select, toggle, and the row that labels
 * them on settings-style pages.
 *
 * They live together because they only earn their keep as a set -- the point
 * is that a switch, a dropdown and a checkbox all present at the same height,
 * radius and border, so a settings page reads as one column of controls.
 */

import type { SelectHTMLAttributes } from "react";

import { Icon } from "./Icon";

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** Two or three mutually exclusive choices, shown inline. */
export function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => !option.disabled && onChange(option.value)}
            disabled={option.disabled}
            title={option.title}
            className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors duration-150
                        disabled:cursor-not-allowed disabled:text-ink-faint/50
                        ${
                          active
                            ? "bg-surface-3 text-ink"
                            : "text-ink-dim hover:text-ink disabled:hover:text-ink-faint/50"
                        }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Native select with the platform chrome replaced by one chevron. */
export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative inline-flex">
      <select
        className={`h-8 w-full appearance-none rounded-lg border border-border bg-surface-2
                    pl-3 pr-8 text-[12px] text-ink transition-colors duration-150
                    hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40
                    ${className}`}
        {...rest}
      />
      <Icon
        name="chevronUpDown"
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

export function Toggle({
  checked, onChange, label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150
                  ${checked ? "border-accent bg-accent" : "border-border bg-surface-3"}`}
    >
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white
                    transition-[left] duration-150 ${checked ? "left-[18px]" : "left-[2px]"}`}
      />
    </button>
  );
}

/**
 * One labelled setting. Description sits under the label rather than beside
 * the control, so the control column stays a straight vertical line.
 */
export function SettingRow({
  label, description, children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-border-soft py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{label}</div>
        <p className="mt-0.5 text-[12px] leading-normal text-ink-faint">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A titled group of setting rows. */
export function SettingGroup({
  title, children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <h2 className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
        {title}
      </h2>
      {/* The rule under the label is what turns a run of settings into a
          bounded block; every grouped list in the app starts with one. */}
      <div className="border-t border-border-soft">{children}</div>
    </section>
  );
}
