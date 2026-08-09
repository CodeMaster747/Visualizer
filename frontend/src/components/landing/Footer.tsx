/**
 * Landing footer.
 *
 * Every link resolves to something that exists today: a section of this page,
 * a route in the app, or a mail client. There is no docs site and no issue
 * tracker to point at yet, and a column of `href="#"` is worse than a shorter
 * column -- it teaches people the footer is decorative.
 */

import { Link } from "react-router-dom";

import { Icon } from "../ui/Icon";

/** Every Contact link, and the support problem report, is built from this. */
const CONTACT_EMAIL = "playerclasher4305@gmail.com";

const mail = (subject: string) =>
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

interface LinkSpec {
  label: string;
  /** `#` anchors this page, `mailto:` opens a client, anything else is a route. */
  to: string;
}

const COLUMNS: { title: string; links: LinkSpec[] }[] = [
  {
    title: "Get Support",
    links: [
      // Everything here has to be readable signed out, which is the state
      // almost everyone reading this footer is in.
      { label: "How it works", to: "#how" },
      { label: "Supported languages", to: "#languages" },
      { label: "Sandboxing & privacy", to: "#security" },
      { label: "Report a problem", to: mail("Visualizer — problem report") },
    ],
  },
  {
    title: "Learn to Use",
    links: [
      // The one link here that needs an account. It survives the detour: the
      // shell's guard carries the path over and sign-in replays it.
      { label: "Example snippets", to: "/app/snippet" },
      { label: "Reading the heap graph", to: "#heap" },
      { label: "Playback & narration", to: "#playback" },
      { label: "Why libraries work", to: "#libraries" },
    ],
  },
  {
    title: "Contact Us",
    links: [
      { label: "General enquiries", to: mail("Visualizer — enquiry") },
      { label: "Feature requests", to: mail("Visualizer — feature request") },
      { label: "Security disclosure", to: mail("Visualizer — security disclosure") },
      { label: "Feedback", to: mail("Visualizer — feedback") },
    ],
  },
];

const LINK_STYLE =
  "text-base text-ink-dim transition-colors duration-150 hover:text-ink";

function FooterLink({ link }: { link: LinkSpec }) {
  const external = link.to.startsWith("#") || link.to.startsWith("mailto:");
  return (
    <li>
      {external ? (
        <a href={link.to} className={LINK_STYLE}>
          {link.label}
        </a>
      ) : (
        <Link to={link.to} className={LINK_STYLE}>
          {link.label}
        </Link>
      )}
    </li>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border-soft bg-surface">
      <div className="mx-auto max-w-[1040px] px-6 py-16 sm:px-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:pr-8">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-on-accent">
                <Icon name="box" size={14} />
              </span>
              <span className="text-base font-semibold text-ink">Visualizer</span>
            </div>
            <p className="mt-3 max-w-[26ch] text-sm leading-relaxed text-ink-faint">
              Watch code run, step by step — libraries, objects and references
              included.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="eyebrow mb-4 text-ink-faint">{column.title}</h2>
              <ul className="flex flex-col gap-3">
                {column.links.map((link) => (
                  <FooterLink key={link.label} link={link} />
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t border-border-soft pt-6
                        sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-ink-faint">
            © {new Date().getFullYear()} Visualizer
          </span>
          <span className="text-sm text-ink-faint">
            Traced code runs sandboxed, with no route to the internet
          </span>
        </div>
      </div>
    </footer>
  );
}
