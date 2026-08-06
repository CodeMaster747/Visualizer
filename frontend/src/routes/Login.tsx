/**
 * Sign in / create account, in whichever of two modes this build was configured
 * for.
 *
 * With a Microsoft Entra External ID tenant, this is a single button handing off
 * to the identity provider -- no password is typed here because none ever
 * should be typed into a page that is not the provider's own.
 *
 * Without one, it is the local-profile form it has always been, and it still
 * does not pretend to be more: no password field, no "forgot your password", no
 * spinner faking a round trip. What it does is real -- it names the local
 * profile that the workspace, the account menu and the profile page all read --
 * and the note under the form says exactly that, because the alternative is
 * someone typing their actual password into a form that stores it in
 * localStorage.
 *
 * Sits outside the app shell: signing in is what gets you the sidebar.
 */

import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { Segmented } from "../components/ui/Controls";
import { Icon } from "../components/ui/Icon";
import { isAuthConfigured } from "../lib/auth";
import { beginAzureSignIn, useAccount } from "../store/account";

type Mode = "signin" | "register";

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Pick up where this browser left off.",
    submit: "Sign in",
  },
  register: {
    title: "Create your account",
    subtitle: "Name the profile your runs and preferences belong to.",
    submit: "Create account",
  },
};

/** Deliberately loose: rejecting valid-but-unusual addresses is the common bug. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one piece of colour in a deliberately monochrome interface.
 *
 * Not an oversight and not a style exception made lightly: Microsoft's branding
 * requirements for a "Sign in with Microsoft" button specify this mark in these
 * colours, and a recoloured third-party logo is worse than a small break in the
 * palette. It lives here rather than in Icon.tsx because that set is defined as
 * one stroke weight in currentColor, and this is neither.
 */
function MicrosoftMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 21 21" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const FIELD =
  `h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-ink
   transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong`;

/** Shared by both sign-in modes: the wordmark, and a way back to the landing page. */
function Header() {
  return (
    <header className="mx-auto flex h-16 w-full shrink-0 max-w-[1040px] items-center px-6 sm:px-10">
      <Link
        to="/"
        className="flex items-center gap-2.5 text-ink-dim transition-colors duration-150 hover:text-ink"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-on-accent">
          <Icon name="box" size={14} />
        </span>
        <span className="text-[13px] font-semibold text-ink">Visualizer</span>
      </Link>
    </header>
  );
}

function Field({
  id, label, children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-ink-dim">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const account = useAccount((s) => s.account);
  const signIn = useAccount((s) => s.signIn);

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Where the shell guard turned them away from, so a deep link survives the
  // detour through this screen.
  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  if (account) return <Navigate to={from} replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setError("Enter an email address.");
      return;
    }
    if (mode === "register" && !name.trim()) {
      setError("Enter a name.");
      return;
    }
    signIn({ name: mode === "register" ? name : undefined, email: address });
    navigate(from, { replace: true });
  };

  const copy = COPY[mode];

  // With a tenant configured, the local form is not merely hidden -- it is not
  // rendered at all, so there is no path left that can mint a profile without a
  // token behind it.
  if (isAuthConfigured()) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-canvas">
        <Header />
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 py-10">
          <h1 className="text-[24px] font-semibold leading-tight text-ink">Welcome</h1>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            Sign in to run code and keep your traces.
          </p>

          <Button
            variant="primary"
            size="md"
            className="mt-7 w-full"
            onClick={() => beginAzureSignIn(from)}
          >
            <MicrosoftMark />
            Continue with Microsoft
          </Button>

          <p className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
            <Icon name="user" size={14} className="mt-px shrink-0" />
            <span>
              You will be taken to Microsoft to sign in. Your password is never
              entered here, and this app only ever receives your name and email
              address.
            </span>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <Header />

      {/* Centred in whatever the header leaves, and still scrollable if a
          short window would otherwise crop the form. */}
      <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 py-10">
        <h1 className="text-[24px] font-semibold leading-tight text-ink">{copy.title}</h1>
        <p className="mt-1.5 text-[13px] text-ink-dim">{copy.subtitle}</p>

        {/* `flex` so the switch hugs its two labels instead of stretching to
            the form width with the buttons packed left. */}
        <div className="mt-7 flex">
          <Segmented<Mode>
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            options={[
              { value: "signin", label: "Sign in" },
              { value: "register", label: "Create account" },
            ]}
          />
        </div>

        {/* Named, because the mode switch above it carries the same two words
            as the submit button and screen readers need them told apart. */}
        <form
          onSubmit={submit}
          noValidate
          aria-label="Account"
          className="mt-6 flex flex-col gap-4"
        >
          {mode === "register" && (
            <Field id="name" label="Name">
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Ada Lovelace"
                className={FIELD}
              />
            </Field>
          )}

          <Field id="email" label="Email">
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className={FIELD}
            />
          </Field>

          {error && (
            <p role="alert" className="flex items-center gap-2 text-[12px] text-danger">
              <Icon name="diamond" size={13} className="shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="md" className="mt-1 w-full">
            {copy.submit}
            <Icon name="arrowRight" size={15} />
          </Button>
        </form>

        <p className="mt-6 flex items-start gap-2 text-[12px] leading-relaxed text-ink-faint">
          <Icon name="user" size={14} className="mt-px shrink-0" />
          <span>
            No password — this build has no account server. Your profile,
            preferences and recent runs are stored in this browser and nowhere
            else.
          </span>
        </p>
      </main>
    </div>
  );
}
