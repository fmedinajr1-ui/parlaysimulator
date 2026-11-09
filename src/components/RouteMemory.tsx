import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const KEY = "last_route_v1";
const SCROLL_KEY = "last_scroll_v1";
const REMEMBER = ["/", "/bets", "/research", "/projections"];
const USER_EVENTS = ["touchstart", "wheel", "keydown", "pointerdown"] as const;

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
    let stopRestore: (() => void) | undefined;
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
          // Restore once the page is tall enough, and never fight the reader:
          // any touch, wheel or key press cancels the restore immediately.
          let tries = 0;
          const stop = () => {
            clearInterval(timer);
            scrollPending.current = false;
            USER_EVENTS.forEach((ev) => window.removeEventListener(ev, stop));
          };
          USER_EVENTS.forEach((ev) => window.addEventListener(ev, stop, { passive: true, once: true }));
          timer = setInterval(() => {
            const maxY = document.documentElement.scrollHeight - window.innerHeight;
            if (maxY >= s.y - 5) {
              window.scrollTo(0, s.y);
              stop();
            } else if (++tries > 80) stop();
          }, 150);
          stopRestore = stop;
        } else scrollPending.current = false;
      }
      if (REMEMBER.includes(loc.pathname)) localStorage.setItem(KEY, loc.pathname);
    } catch { /* Storage may be disabled on the phone. */ }
    return () => { clearInterval(timer); stopRestore?.(); };
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
