/**
 * Route persistence utilities for mobile PWA optimization.
 * Separated from the hook to avoid circular import issues.
 */

export const ROUTE_STORAGE_KEY = 'parlay-farm-persisted-route';
export const SCROLL_STORAGE_KEY = 'parlay-farm-persisted-scroll';
export const CHECKOUT_REDIRECT_STORAGE_KEY = 'parlay-farm-checkout-redirecting';
export const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export interface PersistedRoute {
  pathname: string;
  search: string;
  scrollY: number;
  timestamp: number;
}

export function clearPersistedRoute() {
  try {
    sessionStorage.removeItem(ROUTE_STORAGE_KEY);
    sessionStorage.removeItem(SCROLL_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function consumeCheckoutRedirectFlag() {
  try {
    const wasRedirecting = sessionStorage.getItem(CHECKOUT_REDIRECT_STORAGE_KEY) === 'true';
    if (wasRedirecting) {
      sessionStorage.removeItem(CHECKOUT_REDIRECT_STORAGE_KEY);
      clearPersistedRoute();
    }
    return wasRedirecting;
  } catch {
    return false;
  }
}

export function redirectToExternalCheckout(url: string) {
  try {
    clearPersistedRoute();
    sessionStorage.setItem(CHECKOUT_REDIRECT_STORAGE_KEY, 'true');
  } catch {
    // Continue with checkout even if storage is unavailable
  }
  window.location.href = url;
}

/**
 * Save the current route immediately (useful before backgrounding)
 */
export function saveCurrentRoute() {
  try {
    if (sessionStorage.getItem(CHECKOUT_REDIRECT_STORAGE_KEY) === 'true') return;

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
