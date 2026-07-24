/**
 * The landing page: the first thing an unauthenticated visitor sees.
 *
 * It sits outside the app shell -- no sidebar, full viewport -- and owns its
 * own scroll container, because the body is `overflow: hidden` so the
 * workspace can never scroll as a whole.
 *
 * Everything claimed here is something the product actually does, at the
 * numbers the README measured. A landing page that oversells is a support
 * queue later.
 */

import { Link } from "react-router-dom";

import { Footer } from "../components/landing/Footer";
import { Reveal } from "../components/landing/Reveal";
import {
  HeapVisual,
  LanguagesVisual,
  LibrariesVisual,
  PlaybackVisual,
} from "../components/landing/Visuals";
import { buttonClass } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { useAccount } from "../store/account";

/** Every band on the page shares one measure and one horizontal inset. */
const SHELL = "mx-auto w-full max-w-[1040px] px-6 sm:px-10";

/* -------------------------------------------------------------------------- */

const STATS: [value: string, label: string][] = [
  ["8 steps", "to trace an import, a read_csv and a groupby"],
  ["4 languages", "Python, Java, JavaScript, TypeScript"],
  ["1 format", "one trace document, one replayer"],
];

function Hero({ cta }: { cta: { to: string; label: string } }) {
  return (
    // Centred: there is no hero illustration to balance a left-aligned column
    // against, and half an empty screen is what that reads as.
    <section className={`${SHELL} pb-20 pt-20 text-center sm:pt-28`}>
      <Reveal>
        <span
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface
                     px-3 py-1 text-[11px] font-medium tracking-[0.02em] text-ink-dim"
        >
          <Icon name="sparkle" size={12} className="text-ink-faint" />
          Third-party libraries included
        </span>
      </Reveal>

      <Reveal delay={60}>
        <h1 className="mt-7 text-[44px] font-semibold leading-[1.05] text-ink sm:text-[64px]">
          Visualizer
        </h1>
        <p className="mt-4 text-[22px] font-medium leading-tight text-ink-dim sm:text-[26px]">
          Watch code run, step by step.
        </p>
      </Reveal>

      <Reveal delay={120}>
        <p className="mx-auto mt-6 max-w-[58ch] text-[15px] leading-relaxed text-ink-faint">
          Upload a snippet of Python, Java, JavaScript or TypeScript and step
          through it line by line — every variable, object and reference
          animated at the moment it changes, including the ones created inside
          numpy, pandas and lodash.
        </p>
      </Reveal>

      <Reveal delay={180}>
        <div className="mt-10 flex flex-col items-center gap-4">
          <Link to={cta.to} className={buttonClass({ variant: "primary", size: "lg" })}>
            {cta.label}
            <Icon name="arrowRight" size={16} />
          </Link>
          <span className="text-[12px] text-ink-faint">
            No password, no install — your profile stays in this browser.
          </span>
        </div>
      </Reveal>

      <Reveal delay={240}>
        <dl className="mt-20 grid gap-px overflow-hidden rounded-xl border border-border
                       bg-border-soft sm:grid-cols-3">
          {STATS.map(([value, label]) => (
            <div key={value} className="bg-surface px-6 py-7">
              <dt className="tnum text-[24px] font-semibold leading-none text-ink">{value}</dt>
              <dd className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">{label}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    id: "libraries",
    eyebrow: "Libraries",
    title: "numpy and pandas actually run",
    body: "Most step-through visualizers stop at the standard library, or drown in it. This one retires library code from monitoring the first time it is hit, so the internals run at native speed while the objects they produce still land in the heap snapshot.",
    points: [
      "An import, a read_csv and a groupby: eight steps in 0.16 seconds",
      "User-defined classes are traced in full, not summarised",
      "Uploaded CSVs and datasets are read by bare filename",
    ],
    visual: <LibrariesVisual />,
  },
  {
    id: "heap",
    eyebrow: "References",
    title: "The heap is a graph, not a tree",
    body: "Objects are keyed by identity and variables hold references to them. So two names on one list stay two names on one list, and an object that points back at its own parent draws a cycle instead of an infinite nest.",
    points: [
      "Aliasing stays visible — a = b = [1, 2] is one object, two names",
      "Cycles render as cycles rather than repeating forever",
      "A value that just changed is the only thing on screen using colour",
    ],
    visual: <HeapVisual />,
  },
  {
    id: "languages",
    eyebrow: "Languages",
    title: "Four languages, one replayer",
    body: "Python runs under sys.monitoring, Java under the Java Debug Interface, JavaScript and TypeScript under the V8 inspector. All of them emit the same versioned trace document, and the interface never branches on which one produced it.",
    points: [
      "Python 3.12+, Java 21+, Node 22+",
      "TypeScript is transpiled but never type-checked — broken types still run",
      "A tracer that is offline is shown disabled, not hidden",
    ],
    visual: <LanguagesVisual />,
  },
  {
    id: "playback",
    eyebrow: "Playback",
    title: "The run finishes before you start watching",
    body: "Execution and animation are fully decoupled: the tracer hands over a complete document, so the timeline is scrubbable the instant it loads rather than streamed at you. Jump to the failure, walk backwards from it, and read what happened in plain English.",
    points: [
      "Scrub, step and reverse at four speeds",
      "Optional one-sentence narration for every step",
      "Errors highlight the line that raised them, in context",
    ],
    visual: <PlaybackVisual />,
  },
];

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  return (
    <section id={feature.id} className={`${SHELL} scroll-mt-8 border-t border-border-soft py-20`}>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <Reveal className={flip ? "lg:order-2" : ""}>
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
            {feature.eyebrow}
          </span>
          <h2 className="mt-3 text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">
            {feature.title}
          </h2>
          <p className="mt-4 max-w-[52ch] text-[14px] leading-relaxed text-ink-dim">
            {feature.body}
          </p>
          <ul className="mt-7 flex flex-col gap-3 border-t border-border-soft pt-6">
            {feature.points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-[13px] leading-relaxed text-ink-faint">
                <Icon name="check" size={14} className="mt-[3px] shrink-0 text-ink-dim" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={80} className={flip ? "lg:order-1" : ""}>
          {feature.visual}
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

const GUARANTEES: [icon: IconName, title: string, body: string][] = [
  ["box", "A fresh process per run", "Every trace executes in its own child process or debuggee JVM, killed the moment it exceeds its timeout."],
  ["database", "Locked-down containers", "Tracers run read-only and non-root, with capped memory and process counts, on a noexec filesystem."],
  ["terminal", "No route to the internet", "The tracer network has no gateway, so code you are inspecting cannot call home — verified, not assumed."],
];

function Security() {
  return (
    <section id="security" className={`${SHELL} scroll-mt-8 border-t border-border-soft py-20`}>
      <Reveal>
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint">
          Isolation
        </span>
        <h2 className="mt-3 max-w-[20ch] text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">
          Someone else's code, run carefully
        </h2>
      </Reveal>

      <Reveal delay={80}>
        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {GUARANTEES.map(([icon, title, body]) => (
            <div key={title}>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border
                               bg-surface text-ink-dim">
                <Icon name={icon} size={17} />
              </span>
              <h3 className="mt-4 text-[14px] font-medium text-ink">{title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">{body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function Closing({ cta }: { cta: { to: string; label: string } }) {
  return (
    <section className={`${SHELL} border-t border-border-soft py-24`}>
      <Reveal>
        {/* Centred like the hero: a full-width card with everything packed
            into its left third reads as a layout that ran out of content. */}
        <div className="flex flex-col items-center gap-8 rounded-xl border border-border bg-surface
                        px-8 py-14 text-center sm:px-12">
          <div>
            <h2 className="text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">
              Start with an example
            </h2>
            <p className="mx-auto mt-4 max-w-[54ch] text-[14px] leading-relaxed text-ink-dim">
              Pick a language, load one of the bundled snippets and press
              Visualize. Nothing to configure, nothing to install.
            </p>
          </div>
          <Link to={cta.to} className={buttonClass({ variant: "primary", size: "lg" })}>
            {cta.label}
            <Icon name="arrowRight" size={16} />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

export function Landing() {
  const account = useAccount((s) => s.account);

  // Signed in already: sending someone back through a sign-in form they have
  // no reason to fill in is the redundant step, not the button.
  const cta = account
    ? { to: "/app", label: "Open workspace" }
    : { to: "/login", label: "Get Started" };

  return (
    <div className="h-full overflow-y-auto scroll-smooth bg-canvas">
      {/* Wordmark only. A "Sign in" link up here would go exactly where the
          hero button already goes. */}
      <header className={`${SHELL} flex h-16 items-center gap-2.5`}>
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white">
          <Icon name="box" size={14} />
        </span>
        <span className="text-[13px] font-semibold text-ink">Visualizer</span>
      </header>

      <main>
        <Hero cta={cta} />
        {FEATURES.map((feature, i) => (
          <FeatureRow key={feature.id} feature={feature} flip={i % 2 === 1} />
        ))}
        <Security />
        <Closing cta={cta} />
      </main>

      <Footer />
    </div>
  );
}
