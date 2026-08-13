/**
 * Smoke test for the shell: every route must mount, and navigation between
 * them must not lose the sidebar.
 *
 * Plus the gate in front of it. The workspace is the half of the app behind a
 * sign-in, so "signed out lands on the landing page" and "signed in lands on
 * the workspace" are the two assertions the routing actually rests on.
 *
 * Monaco is stubbed -- it loads its worker bundle over the network, which is
 * neither available nor interesting here. Everything else is the real thing,
 * including all three zustand stores and their localStorage persistence.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="editor" />,
}));

import App from "./App";
import { useAccount } from "./store/account";
import { usePrefs } from "./store/prefs";
import { useRecents } from "./store/recents";
import { useSession } from "./store/session";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/**
 * The state the workspace tests all assume: somebody is signed in.
 *
 * Set directly rather than driven through the form, because signing in is now a
 * network round trip and these tests are about the shell, not about auth.
 */
function signIn() {
  useAccount.setState({
    account: { name: "Ada Lovelace", email: "ada@example.com", initials: "AL" },
  });
}

/**
 * Stub the API's answer to a sign-in or registration.
 *
 * The token has to be one the app will accept -- it decodes the payload and
 * checks the expiry before storing anything -- so it is built the same way the
 * server builds it, minus a signature nothing in the browser verifies.
 */
function respondWithSession(user: { name: string; email: string }) {
  const claims = { sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600, ...user };
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token: `header.${payload}.sig`, user }),
    }),
  );
}

/** The sign-in form, scoped: the mode switch above it repeats both labels. */
const form = () => within(screen.getByRole("form", { name: "Account" }));

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  // jsdom here has no localStorage; zustand's persist middleware degrades to
  // in-memory, which is exactly what these assertions want anyway.
  globalThis.localStorage?.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  usePrefs.setState({ sidebarCollapsed: false, defaultLanguage: "python" });
  useRecents.setState({ runs: [] });
  useAccount.setState({ account: null });
  // The workspace session is seeded once per page load; each test is a load.
  useSession.setState({ initialized: false });
});

describe("landing page", () => {
  it("is what the root path opens to, not the workspace", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: "Visualizer" })).toBeDefined();
    expect(screen.getByText("Watch code run, step by step.")).toBeDefined();
    // The shell must not be behind it.
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("points its call to action at sign-in while signed out", () => {
    renderAt("/");
    const cta = screen.getAllByRole("link", { name: /Get Started/ });
    expect(cta.length).toBeGreaterThan(0);
    expect(cta[0]!.getAttribute("href")).toBe("/login");
  });

  it("sends a signed-in visitor straight to the workspace instead", () => {
    signIn();
    renderAt("/");
    expect(screen.queryByText("Get Started")).toBeNull();
    expect(screen.getAllByRole("link", { name: /Open workspace/ })[0]!.getAttribute("href"))
      .toBe("/app");
  });

  it("carries a footer with every support column", () => {
    renderAt("/");
    for (const column of ["Get Support", "Learn to Use", "Contact Us"]) {
      expect(screen.getByRole("heading", { name: column })).toBeDefined();
    }
  });

  it("explains the run loop before it argues about it", () => {
    renderAt("/");
    for (const step of ["Paste or upload", "It runs once, sandboxed", "Scrub the timeline"]) {
      expect(screen.getByRole("heading", { name: step })).toBeDefined();
    }
  });

  it("anchors the footer's How it works link at a section that exists", () => {
    const { container } = renderAt("/");
    const link = screen.getByRole("link", { name: "How it works" });
    expect(link.getAttribute("href")).toBe("#how");
    expect(container.querySelector("#how")).not.toBeNull();
  });

  // A footer link landing on a sign-in form teaches people the footer is a
  // wall. The one link that needs an account says so in its label.
  it("never sends a footer link to the sign-in form", () => {
    renderAt("/");
    const footer = within(screen.getByRole("contentinfo"));
    for (const link of footer.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("/login");
    }
  });
});

describe("sign in", () => {
  it("signs in and opens the workspace", async () => {
    // The account has no display name, so the one shown must be derived from
    // the address rather than left blank.
    respondWithSession({ name: "", email: "ada@example.com" });
    renderAt("/login");

    fill("Email", "ada@example.com");
    fill("Password", "hunter2!!");
    fireEvent.click(form().getByRole("button", { name: "Sign in" }));

    // Landed in the shell, with the profile the server returned.
    expect(await screen.findByRole("navigation")).toBeDefined();
    expect(useAccount.getState().account?.email).toBe("ada@example.com");
    expect(useAccount.getState().account?.name).toBe("Ada");
  });

  it("takes a name when registering", async () => {
    respondWithSession({ name: "Grace Hopper", email: "grace@example.com" });
    renderAt("/login");

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fill("Name", "Grace Hopper");
    fill("Email", "grace@example.com");
    fill("Password", "hunter2!!");
    fireEvent.click(form().getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("navigation")).toBeDefined();
    expect(useAccount.getState().account).toMatchObject({
      name: "Grace Hopper",
      initials: "GH",
    });
  });

  it("refuses a junk address without asking the server", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderAt("/login");

    fill("Email", "not-an-address");
    fill("Password", "hunter2!!");
    fireEvent.click(form().getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("alert")).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(useAccount.getState().account).toBeNull();
  });

  it("shows the server's reason and stays put when credentials are wrong", async () => {
    // The failure the user actually hits. It has to land on this screen with a
    // message, not bounce them into a workspace they cannot use.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: "Incorrect email or password." }),
      }),
    );
    renderAt("/login");

    fill("Email", "ada@example.com");
    fill("Password", "wrong-password");
    fireEvent.click(form().getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Incorrect email or password.");
    expect(useAccount.getState().account).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("rejects a too-short password before the server has to", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderAt("/login");

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fill("Name", "Ada");
    fill("Email", "ada@example.com");
    fill("Password", "short");
    fireEvent.click(form().getByRole("button", { name: "Create account" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 8 characters/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("app shell", () => {
  beforeEach(signIn);

  it("renders the home page with both entry points", () => {
    renderAt("/app");
    // Scoped to the page: the sidebar carries the same two labels.
    const page = within(screen.getByRole("main"));
    expect(page.getByRole("heading", { level: 1 })).toBeDefined();
    expect(page.getByText("Code snippet")).toBeDefined();
    expect(page.getByText("Codebase")).toBeDefined();
    expect(page.getByText("Soon")).toBeDefined();
  });

  it("greets the signed-in account by first name", () => {
    renderAt("/app");
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 }).textContent)
      .toMatch(/, Ada$/);
  });

  it("lists recent runs once a snippet has been traced", () => {
    useRecents.getState().record({
      title: "a = [1, 2, 3]",
      language: "python",
      source: "a = [1, 2, 3]\n",
      files: [],
      status: "ok",
      steps: 12,
    });
    renderAt("/app");
    expect(screen.getByText("a = [1, 2, 3]")).toBeDefined();
    expect(screen.getByText("12 steps")).toBeDefined();
  });

  it.each(["/app/snippet", "/app/codebase", "/app/profile", "/app/settings"])(
    "renders %s inside the shell",
    (path) => {
      renderAt(path);
      // The sidebar is persistent: it must survive on every route.
      expect(screen.getByRole("navigation")).toBeDefined();
    },
  );

  it("seeds the snippet workspace from the default-language preference", () => {
    usePrefs.setState({ defaultLanguage: "java" });
    renderAt("/app/snippet");
    // Java's example set, not Python's, means the session took the preference.
    expect(screen.getByRole("option", { name: "Objects & refs" })).toBeDefined();
  });

  it("falls back to the landing page for unknown paths", () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { level: 1, name: "Visualizer" })).toBeDefined();
  });
});

describe("the workspace gate", () => {
  it("turns a signed-out visitor away from the shell", () => {
    renderAt("/app/snippet");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back" })).toBeDefined();
  });

  it("returns them to the page they asked for once signed in", async () => {
    respondWithSession({ name: "Ada Lovelace", email: "ada@example.com" });
    renderAt("/app/settings");

    fill("Email", "ada@example.com");
    fill("Password", "hunter2!!");
    fireEvent.click(form().getByRole("button", { name: "Sign in" }));

    // Settings, not the workspace home page.
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeDefined();
  });
});
