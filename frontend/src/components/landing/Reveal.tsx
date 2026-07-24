/**
 * Reveal-on-scroll. The only animation on the landing page.
 *
 * One effect -- fade up, 500ms, the app's standard ease -- applied at section
 * granularity rather than per element, because a page where every paragraph
 * arrives separately reads as a demo of scroll libraries. It fires once and
 * disconnects: content re-animating on the way back up is motion with no
 * information in it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { usePrefs } from "../../store/prefs";

interface Props {
  children: ReactNode;
  /** Staggers siblings within a section, in milliseconds. */
  delay?: number;
  className?: string;
}

export function Reveal({ children, delay = 0, className = "" }: Props) {
  const reducedMotion = usePrefs((s) => s.reducedMotion);
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    // No observer -- jsdom, an ancient browser -- means no way to learn that
    // the element arrived, so it starts arrived. Content that needs an
    // animation to run before it becomes readable is content that can go
    // missing entirely.
    if (!node || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      // Fires a little after the top edge, so a section animates while it is
      // being read into rather than the instant its first pixel appears.
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-[opacity,transform] duration-500 ${
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
