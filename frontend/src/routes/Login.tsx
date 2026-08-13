/**
 * Sign in / create account.
 *
 * A real form against a real account server: the password is hashed with BCrypt
 * on the way in and never stored anywhere in this browser, and what comes back
 * is an access token that every API call carries. The note under the form says
 * what is true, because the previous version of this screen had to explain that
 * it was a local profile with no password, and an honest note is the only thing
 * that made that acceptable.
 *
 * Sits outside the app shell: signing in is what gets you the sidebar.
 */

import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { Input, Segmented } from "../components/ui/Controls";
import { Icon } from "../components/ui/Icon";
import { useAccount } from "../store/account";

type Mode = "signin" | "register";

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; busy: string }> = {
  signin: {
    title: "Welcome back",
    subtitle: "Sign in to run code and keep your traces.",
    submit: "Sign in",
    busy: "Signing in…",
  },
  register: {
    title: "Create your account",
    subtitle: "One account, and the workspace is yours.",
    submit: "Create account",
    busy: "Creating…",
  },
};

/** Deliberately loose: rejecting valid-but-unusual addresses is the common bug. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors the server's rule, so the round trip is skipped for an obvious miss. */
const MIN_PASSWORD = 8;

/** Shared by both modes: the wordmark, and a way back to the landing page. */
function Header() {
  return (
    <header className="mx-auto flex h-16 w-full shrink-0 max-w-[1040px] items-center px-6 sm:px-10">
      <Link
        to="/"
        className="flex items-center gap-2 text-ink-dim transition-colors duration-150 hover:text-ink"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-on-accent">
          <Icon name="box" size={14} />
        </span>
        <span className="text-base font-semibold text-ink">Visualizer</span>
      </Link>
    </header>
  );
}

function Field({
  id, label, hint, children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* The label is dim and the input's text is not, so the two are told
          apart by weight rather than by the reader working out which box is
          which. */}
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink-dim">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const account = useAccount((s) => s.account);
  const signIn = useAccount((s) => s.signIn);
  const signUp = useAccount((s) => s.signUp);

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Where the shell guard turned them away from, so a deep link survives the
  // detour through this screen.
  const from = (location.state as { from?: string } | null)?.from ?? "/app";

  if (account) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const address = email.trim();
    if (!EMAIL.test(address)) {
      setError("Enter an email address.");
      return;
    }
    // Only on the way in. Checking length at sign-in would reject an older
    // account whose password predates the rule, which is a confusing way to
    // tell someone their own password is wrong.
    if (mode === "register" && password.length < MIN_PASSWORD) {
      setError(`Passwords must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await signUp({ name: name.trim(), email: address, password });
      else await signIn({ email: address, password });
      navigate(from, { replace: true });
    } catch (failure) {
      // The server's own sentence, which is more specific than anything this
      // screen could infer -- "Incorrect email or password.", or that the
      // address is already registered.
      setError(failure instanceof Error ? failure.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  const copy = COPY[mode];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <Header />

      {/* Centred in whatever the header leaves, and still scrollable if a
          short window would otherwise crop the form. */}
      <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 py-10">
        <h1 className="text-2xl font-semibold text-ink">{copy.title}</h1>
        <p className="mt-2 text-base text-ink-dim">{copy.subtitle}</p>

        {/* `flex` so the switch hugs its two labels instead of stretching to
            the form width with the buttons packed left. `md` so it stands at
            the same 36px as the fields below it. */}
        <div className="mt-8 flex">
          <Segmented<Mode>
            size="md"
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
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="Ada Lovelace"
              />
            </Field>
          )}

          <Field id="email" label="Email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>

          <Field
            id="password"
            label="Password"
            hint={mode === "register" ? `At least ${MIN_PASSWORD} characters.` : undefined}
          >
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // Tells a password manager which of the two this is; without it
              // a sign-in offers to save a new entry every time.
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="••••••••"
            />
          </Field>

          {error && (
            <p role="alert" className="flex items-center gap-2 text-sm text-danger">
              <Icon name="diamond" size={12} className="shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="mt-1 w-full"
            disabled={busy}
          >
            {busy ? copy.busy : copy.submit}
            {!busy && <Icon name="arrowRight" size={16} />}
          </Button>
        </form>

        <p className="mt-6 flex items-start gap-2 text-sm leading-relaxed text-ink-faint">
          <Icon name="user" size={14} className="mt-[2px] shrink-0" />
          <span>
            Your password is hashed before it is stored and never leaves the
            server. Closing this tab signs you out.
          </span>
        </p>
      </main>
    </div>
  );
}
