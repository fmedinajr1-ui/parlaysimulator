import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const KEY = "last_route_v1";
const SCROLL_KEY = "last_scroll_v1";
const REMEMBER = ["/", "/bets", "/research", "/projections"];

/**
 * Phones throw away background tabs to save memory, so coming back can look like a reload.
 * Remember the desk page and scroll spot so the app reopens exactly where you left it.
 */
export function RouteMemory() {
  const loc = useLocation();
  const nav = useNavigate();
  const first = useRef(true);
  const scrollPending = useRef(true);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const fresh = !performance.getEntriesByType?.("navigation")?.some((e) => (e as PerformanceNavigationTiming).type === "reload");
      if (first.current) {
        first.current = false;
        const last = localStorage.getItem(KEY);
        if (fresh && loc.pathname === "/" && !loc.search && last && last !== "/" && REMEMBER.includes(last)) { nav(last, { replace: true }); return; }
      }
      if (scrollPending.current) {
        // Wait until the restored route's content can reach its saved scroll spot.
        const s = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || localStorage.getItem(SCROLL_KEY) || "null");
        if (fresh && s && s.path === loc.pathname && s.y > 0) {
          let tries = 0;
          timer = setInterval(() => {
            window.scrollTo(0, s.y);
            if (Math.abs(window.scrollY - s.y) < 5 || ++tries > 40) {
              clearInterval(timer);
              scrollPending.current = false;
            }
          }, 150);
        } else scrollPending.current = false;
      }
      if (REMEMBER.includes(loc.pathname)) localStorage.setItem(KEY, loc.pathname);
    } catch { /* Storage may be disabled on the phone. */ }
    return () => clearInterval(timer);
  }, [loc.pathname, loc.search, nav]);

  useEffect(() => {
    const save = () => {
      const v = JSON.stringify({ path: window.location.pathname, y: window.scrollY });
      try { localStorage.setItem(SCROLL_KEY, v); sessionStorage.setItem(SCROLL_KEY, v); } catch { /* ignore */ }
    };
    const onVis = () => { if (document.visibilityState === "hidden") save(); };
    let to: ReturnType<typeof setTimeout>;
    const onScroll = () => { clearTimeout(to); to = setTimeout(save, 300); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", save);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(to);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return null;
}
