/**
 * Routing, in two halves.
 *
 * Public: the landing page and the sign-in screen, each owning the whole
 * viewport. Private: everything under `/app`, wrapped in the shell -- the
 * persistent sidebar plus the routed screen beside it.
 *
 * The shell owns nothing but layout. Every screen is a leaf, and the snippet
 * visualizer keeps its own state, so navigating away and back re-mounts a
 * clean workspace rather than resurrecting a half-scrubbed trace.
 */

import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { Sidebar } from "./components/shell/Sidebar";
import { Codebase } from "./routes/Codebase";
import { Home } from "./routes/Home";
import { Landing } from "./routes/Landing";
import { Login } from "./routes/Login";
import { Profile } from "./routes/Profile";
import { Settings } from "./routes/Settings";
import { Snippet } from "./routes/Snippet";
import { useAccount } from "./store/account";
import { usePrefs } from "./store/prefs";

/**
 * The workspace frame, and the gate in front of it.
 *
 * The gate carries the attempted path across to the sign-in screen, so a link
 * to a deep page survives the detour instead of dumping everyone on the home
 * screen after they sign in.
 */
function Shell() {
  const account = useAccount((s) => s.account);
  const location = useLocation();

  if (!account) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  const reducedMotion = usePrefs((s) => s.reducedMotion);

  // The preference is applied on <html> so plain CSS can honour it, the same
  // way the OS-level media query already does.
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/app" element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="snippet" element={<Snippet />} />
        <Route path="codebase" element={<Codebase />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
