/**
 * Form controls: text field, segmented switch, select, toggle, and the rows
 * that label them on settings-style pages.
 *
 * They live together because they only earn their keep as a set -- the point
 * is that a field, a switch, a dropdown and a checkbox all present at the same
 * height, radius and border, so a settings page reads as one column of
 * controls.
 *
 * Two heights, and the choice between them is contextual rather than
 * aesthetic: `sm` (32px) for controls packed into a toolbar beside a dense
 * view, `md` (36px) for anything inside a form, where the extra four pixels
 * are the difference between a field that is comfortable to type in and one
 * that merely fits.
 */

import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

import { Icon } from "./Icon";

type ControlSize = "sm" | "md";

/** Height and the type size that sits comfortably in it, as one decision. */
const CONTROL: Record<ControlSize, string> = {
  sm: "h-control-sm text-sm",
  md: "h-control-md text-base",
};

/* -------------------------------------------------------------------------- */

/** Single-line text input. The `field` recipe carries border, focus and hover. */
export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`field w-full px-3 ${CONTROL.md} ${className}`} {...rest} />;
}

/* -------------------------------------------------------------------------- */

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

/** Two or three mutually exclusive choices, shown inline. */
export function Segmented<T extends string>({
  value, options, onChange, size = "sm",
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: ControlSize;
}) {
  return (
    <div
      className={`flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5
                  ${CONTROL[size]}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => !option.disabled && onChange(option.value)}
            disabled={option.disabled}
            title={option.title}
            // self-stretch, not a fixed height: the pill then fills whatever
            // the track leaves after its border and 2px inset, at either size,
            // and sits flush inside the border rather than near it.
            className={`self-stretch rounded-md px-3 font-medium transition-colors duration-150
                        disabled:cursor-not-allowed disabled:text-ink-faint/50
                        ${
                          active
                            ? "bg-surface-3 text-ink"
                            : "text-ink-dim hover:text-ink active:bg-surface-3/60 disabled:hover:text-ink-faint/50"
                        }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * `size` is omitted from the native attributes deliberately: on a `<select>`
 * it means "show N rows at once", which turns the control into a list box and
 * is not something this app ever wants. The name is reused for the height
 * scale, which is what every other control in this file calls it.
 */
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: ControlSize;
}

/** Native select with the platform chrome replaced by one chevron. */
export function Select({ className = "", size = "md", ...rest }: SelectProps) {
  return (
    <div className="relative inline-flex">
      <select
        className={`field w-full appearance-none pl-3 pr-8 ${CONTROL[size]} ${className}`}
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

/* -------------------------------------------------------------------------- */

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
                  ${checked ? "border-accent bg-accent" : "border-border bg-surface-3 hover:border-border-strong"}`}
    >
      {/* The knob inverts with the track: on a lit track it is the dark cut-out,
          on an unlit one it is the lit part. Either way it stays visible. */}
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full
                    transition-[left,background-color] duration-150
                    ${checked ? "left-[18px] bg-on-accent" : "left-[2px] bg-ink-faint"}`}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One row of a grouped list: a label on the left, a value or control on the
 * right, and a hairline under it.
 *
 * Profile and Settings both draw this shape, and drew it at two different
 * heights before they shared it. The 16px inset is the app's row rhythm.
 *
 * Emphasis follows the description, because the two uses genuinely differ. A
 * row with a description is a setting: the label is a heading and takes the
 * full ramp, the control speaks for itself. A row without one is a key/value
 * pair: the label is the key and the value on the right is what the reader
 * came for, so the weight is the other way round.
 */
export function Row({
  label, description, children,
}: {
  label: string;
  /** Sits under the label rather than beside the control, so the control
   *  column stays a straight vertical line. */
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-border-soft py-4 last:border-b-0">
      <div className="min-w-0">
        <div className={`text-base ${description ? "text-ink" : "text-ink-dim"}`}>{label}</div>
        {description && <p className="mt-1 text-sm text-ink-faint">{description}</p>}
      </div>
      <div className={`min-w-0 shrink-0 truncate text-base ${description ? "" : "text-ink"}`}>
        {children}
      </div>
    </div>
  );
}

/** A labelled setting: a `Row` whose description is required. */
export function SettingRow({
  label, description, children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Row label={label} description={description}>
      {children}
    </Row>
  );
}

/** A titled group of rows. */
export function SettingGroup({
  title, children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8 last:mb-0">
      <h2 className="eyebrow mb-2 text-ink-faint">{title}</h2>
      {/* The rule under the label is what turns a run of settings into a
          bounded block; every grouped list in the app starts with one. */}
      <div className="border-t border-border-soft">{children}</div>
    </section>
  );
}
