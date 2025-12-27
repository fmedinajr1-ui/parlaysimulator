/**
 * Route persistence utilities for mobile PWA optimization.
 * Separated from the hook to avoid circular import issues.
 */

export const ROUTE_STORAGE_KEY = 'parlay-farm-persisted-route';
export const SCROLL_STORAGE_KEY = 'parlay-farm-persisted-scroll';
export const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface PersistedRoute {
  pathname: string;
  search: string;
  scrollY: number;
  timestamp: number;
}

/**
 * Save the current route immediately (useful before backgrounding)
 */
export function saveCurrentRoute() {
  try {
    const routeData: PersistedRoute = {
      pathname: window.location.pathname,
      search: window.location.search,
      scrollY: window.scrollY,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(routeData));
  } catch {
    // Ignore save errors
  }
}
