/**
 * The only button in the app.
 *
 * Three variants and three heights, all sharing one radius, one padding rhythm
 * and one 150ms colour transition -- so "is this clickable" is answered the
 * same way on every screen.
 *
 * `buttonClass` is the same recipe without the element, for the handful of
 * places where the control is really a link (the landing CTA) and should keep
 * its middle-click and open-in-new-tab behaviour rather than be a button that
 * calls `navigate`.
 */

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:brightness-110 disabled:hover:brightness-100",
  secondary:
    "border border-border bg-surface-2 text-ink hover:border-border-strong hover:bg-surface-3",
  ghost: "text-ink-dim hover:bg-surface-2 hover:text-ink",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-[12px]",
  md: "h-9 gap-2 px-4 text-[13px]",
  // Marketing weight. The app never needs this; a hero CTA at 36px does not
  // read as the one thing on the screen to press.
  lg: "h-11 gap-2 px-6 text-[14px]",
};

const ICON_SIZE: Record<Size, string> = { sm: "h-8 w-8", md: "h-9 w-9", lg: "h-11 w-11" };

const BASE = `inline-flex shrink-0 items-center justify-center rounded-lg font-medium
              transition-[background-color,border-color,color,filter] duration-150
              disabled:cursor-not-allowed disabled:opacity-40`;

interface Style {
  variant?: Variant;
  size?: Size;
  /** Square, no label -- padding collapses so the glyph sits dead centre. */
  iconOnly?: boolean;
  className?: string;
}

export function buttonClass({
  variant = "secondary",
  size = "sm",
  iconOnly = false,
  className = "",
}: Style = {}): string {
  return `${BASE} ${VARIANT[variant]} ${iconOnly ? ICON_SIZE[size] : SIZE[size]} ${className}`;
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, Style {}

export function Button({ variant, size, iconOnly, className, ...rest }: Props) {
  return <button className={buttonClass({ variant, size, iconOnly, className })} {...rest} />;
}
