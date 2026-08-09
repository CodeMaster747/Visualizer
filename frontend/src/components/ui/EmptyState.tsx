/**
 * What a region says when it has nothing to show.
 *
 * Centred, quiet, and always the same shape: an optional glyph, one line of
 * what belongs here, and nothing else competing for attention.
 */

import { Icon, type IconName } from "./Icon";

interface Props {
  text: string;
  icon?: IconName;
  title?: string;
  children?: React.ReactNode;
}

export function EmptyState({ text, icon, title, children }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-8 text-center">
      {icon && (
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-ink-faint">
          <Icon name={icon} size={18} />
        </div>
      )}
      {title && <h3 className="mb-2 text-lg font-medium text-ink">{title}</h3>}
      <p className="max-w-[42ch] text-sm leading-relaxed text-ink-faint">{text}</p>
      {children && <div className="mt-6">{children}</div>}
    </div>
  );
}
