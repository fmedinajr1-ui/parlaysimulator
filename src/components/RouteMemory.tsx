import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const KEY = "last_route_v1";
const REMEMBER = ["/bets", "/research"];

/** When the home-screen app relaunches at "/", reopen the page you were last on (phones often kill apps in the background). */
export function RouteMemory() {
  const loc = useLocation();
  const nav = useNavigate();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      const last = localStorage.getItem(KEY);
      if (standalone && loc.pathname === "/" && last && REMEMBER.includes(last)) { nav(last, { replace: true }); return; }
    }
    localStorage.setItem(KEY, loc.pathname);
  }, [loc.pathname, nav]);
  return null;
}
