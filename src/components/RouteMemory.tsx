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

  useEffect(() => {
    if (first.current) {
      first.current = false;
      const last = localStorage.getItem(KEY);
      const fresh = !performance.getEntriesByType?.("navigation")?.some((e) => (e as PerformanceNavigationTiming).type === "reload");
      if (fresh && loc.pathname === "/" && last && last !== "/" && REMEMBER.includes(last)) { nav(last, { replace: true }); return; }
      // Restore scroll after the page's data paints.
      try {
        const s = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || localStorage.getItem(SCROLL_KEY) || "null");
        if (fresh && s && s.path === loc.pathname && s.y > 0) {
          let tries = 0;
          const t = setInterval(() => {
            window.scrollTo(0, s.y);
            if (Math.abs(window.scrollY - s.y) < 5 || ++tries > 40) clearInterval(t);
          }, 150);
        }
      } catch { /* ignore */ }
    }
    if (REMEMBER.includes(loc.pathname)) localStorage.setItem(KEY, loc.pathname);
  }, [loc.pathname, nav]);

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
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return null;
}
