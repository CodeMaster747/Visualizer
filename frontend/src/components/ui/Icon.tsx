/**
 * The whole icon set, inline.
 *
 * One file, one stroke weight, one viewBox: the alternative -- an icon package
 * plus emoji glyphs where the package came up short -- is how icon sets drift
 * into three optical weights and four sizes. Everything here is 24x24,
 * stroke 1.5, currentColor, so an icon always matches the text beside it.
 *
 * Four rendered sizes, chosen by the type an icon sits next to rather than by
 * eye. There were eight before (10, 12, 13, 14, 15, 16, 17, 18), which is what
 * a set looks like when each call site picks the number that felt right:
 *
 *     12   beside 2xs/xs text (10-11px)
 *     14   beside sm/base text (12-13px), and in toolbars
 *     16   navigation, and the default
 *     18   standalone glyphs: feature marks, empty states
 */

import type { SVGProps } from "react";

const PATHS = {
  home: <path d="M4 10.4 12 4l8 6.4V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />,
  code: <path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5" />,
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.75 20a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  settings: (
    <>
      <path d="M20 7.5h-8.5M8 7.5H4M20 16.5h-4M12.5 16.5H4" />
      <circle cx="9.5" cy="7.5" r="2.25" />
      <circle cx="14.5" cy="16.5" r="2.25" />
    </>
  ),
  logout: <path d="M15 16.5 19.5 12 15 7.5M19.5 12H9M12 4H6.5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6.5 20H12" />,
  sidebar: (
    <>
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.25" />
      <path d="M9.75 4.75v14.5" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.5-1.5" />
    </>
  ),
  chevronRight: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  chevronLeft: <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronUpDown: <path d="m8 10.5 4-4 4 4M8 13.5l4 4 4-4" />,
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  check: <path d="m5.5 12.5 4.5 4.5 8.5-9.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.25" ry="2.75" />
      <path d="M4.75 6v12c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75V6" />
      <path d="M4.75 12c0 1.52 3.25 2.75 7.25 2.75S19.25 13.52 19.25 12" />
    </>
  ),
  terminal: <path d="m5 8 4 4-4 4M13 16h6" />,
  box: (
    <>
      <path d="M20.25 8.5v7l-8.25 4.5-8.25-4.5v-7L12 4z" />
      <path d="m3.75 8.5 8.25 4.5 8.25-4.5M12 13v7" />
    </>
  ),
  stack: <path d="M4.5 7h15M4.5 12h15M4.5 17h9" />,
  sparkle: <path d="m12 4 1.9 4.85L18.75 10.75 13.9 12.65 12 17.5l-1.9-4.85L5.25 10.75l4.85-1.9zM18.5 3.5v3M20 5h-3" />,
  play: <path d="M8.5 5.5 18 12l-9.5 6.5z" />,
  // Transport glyphs are closed shapes rather than strokes so `filled` works.
  pause: <path d="M9 5.5h1.9v13H9zM13.1 5.5H15v13h-1.9z" />,
  skipStart: <path d="M18 5.5 8.5 12 18 18.5zM5.5 5.5h1.6v13H5.5z" />,
  skipEnd: <path d="M6 5.5 15.5 12 6 18.5zM16.9 5.5h1.6v13h-1.6z" />,
  stepBack: <path d="M15.5 5.5 6 12l9.5 6.5z" />,
  stepForward: <path d="M8.5 5.5 18 12l-9.5 6.5z" />,
  diamond: <path d="m12 4.5 7.5 7.5-7.5 7.5L4.5 12z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  file: (
    <>
      <path d="M13.5 3.75H7a1.75 1.75 0 0 0-1.75 1.75v13A1.75 1.75 0 0 0 7 20.25h10a1.75 1.75 0 0 0 1.75-1.75V9z" />
      <path d="M13.25 3.75V9h5.25" />
    </>
  ),
  repo: (
    <>
      <path d="M6.5 3.75h11a1 1 0 0 1 1 1v14.5H6.5a2.25 2.25 0 0 1 0-4.5h12" />
      <path d="M6.5 3.75a2.25 2.25 0 0 0-2.25 2.25v11" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Solid glyphs (play, step) read better filled at small sizes. */
  filled?: boolean;
}

export function Icon({ name, size = 16, filled = false, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
