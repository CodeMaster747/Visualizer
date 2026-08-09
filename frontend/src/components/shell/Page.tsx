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
      {/* Asymmetric on purpose: 40px above the title, 64px below the content.
          An equal inset leaves the last row of a scrolled page sitting flush
          on the viewport edge, which reads as the page having been cut off. */}
      <div
        className={`mx-auto px-8 pb-16 pt-10 ${
          width === "narrow" ? "max-w-[640px]" : "max-w-[880px]"
        }`}
      >
        <header className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-2 text-base text-ink-dim">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  );
}
