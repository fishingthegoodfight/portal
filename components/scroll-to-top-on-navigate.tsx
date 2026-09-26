"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Starts every new page at the top. The App Router only scrolls when the new
 * page isn't already in view, and with cacheComponents it keeps recent routes
 * alive (hidden) with their scroll positions — so without this, moving to a
 * new screen lands wherever the previous one was scrolled to.
 *
 * Only on a change of path: search-param-only navigations (filter pills,
 * `scroll={false}`) stay put. Browser back/forward is left alone so it still
 * restores where you were, and a `#hash` link still scrolls to its target.
 */
export function ScrollToTopOnNavigate() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  // The path a back/forward landed on, so that navigation keeps the
  // position the browser restores.
  const historyPath = useRef<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      historyPath.current = window.location.pathname;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const fromHistory = historyPath.current === pathname;
    historyPath.current = null;
    if (fromHistory) return;
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
