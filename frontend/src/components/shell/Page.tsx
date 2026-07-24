/**
 * The frame every non-workspace screen sits in.
 *
 * Fixed measure, fixed page inset, fixed distance from title to content: Home,
 * Codebase, Profile and Settings all start on exactly the same baseline, which
 * is most of what makes moving between them feel like one product.
 */

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Settings-style pages read better narrower than Home. */
  width?: "default" | "narrow";
}

export function Page({ title, subtitle, actions, children, width = "default" }: Props) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={`mx-auto px-8 py-10 ${width === "narrow" ? "max-w-[640px]" : "max-w-[880px]"}`}>
        <header className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold leading-tight text-ink">{title}</h1>
            {subtitle && <p className="mt-1.5 text-[13px] text-ink-dim">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}
