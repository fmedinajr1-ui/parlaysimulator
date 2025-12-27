import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
  ROUTE_STORAGE_KEY, 
  SCROLL_STORAGE_KEY, 
  MAX_AGE_MS, 
  type PersistedRoute 
} from '@/utils/routePersistence';

// Re-export for backwards compatibility
export { saveCurrentRoute } from '@/utils/routePersistence';

/**
 * Hook that persists the current route and scroll position to sessionStorage.
 * When the app reloads (e.g., after iOS kills the PWA), it restores the previous location.
 * Also handles popstate events for proper swipe-back navigation.
 */
export function useRoutePersistence() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasRestoredRef = useRef(false);
  const isInitialMountRef = useRef(true);
  const isPopstateNavigationRef = useRef(false);

  // Restore route on initial mount (only once)
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    try {
      const stored = sessionStorage.getItem(ROUTE_STORAGE_KEY);
      if (!stored) return;

      const persisted: PersistedRoute = JSON.parse(stored);
      
      // Check if the stored route is still fresh
      if (Date.now() - persisted.timestamp > MAX_AGE_MS) {
        sessionStorage.removeItem(ROUTE_STORAGE_KEY);
        sessionStorage.removeItem(SCROLL_STORAGE_KEY);
        return;
      }

      // Only restore if we're on the root path (indicates a fresh load)
      const currentPath = window.location.pathname + window.location.search;
      const storedPath = persisted.pathname + persisted.search;
      
      if (currentPath !== storedPath && window.location.pathname === '/') {
        // Navigate to the stored route
        navigate(storedPath, { replace: true });
        
        // Restore scroll position after navigation
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo(0, persisted.scrollY);
          });
        });
      }
    } catch (error) {
      console.warn('[useRoutePersistence] Failed to restore route:', error);
    }
  }, [navigate]);

  // Save route on every location change
  useEffect(() => {
    // Skip saving on initial mount to avoid overwriting stored route
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    // Skip saving if this was a popstate navigation (browser handled it)
    if (isPopstateNavigationRef.current) {
      isPopstateNavigationRef.current = false;
      return;
    }

    try {
      const routeData: PersistedRoute = {
        pathname: location.pathname,
        search: location.search,
        scrollY: window.scrollY,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(routeData));
    } catch (error) {
      console.warn('[useRoutePersistence] Failed to save route:', error);
    }
  }, [location.pathname, location.search]);

  // Handle popstate events (swipe-back, forward/back buttons)
  // React Router handles this automatically, but we need to track it
  useEffect(() => {
    const handlePopState = () => {
      // Mark that this navigation came from popstate (browser gesture)
      // React Router will handle the actual navigation
      isPopstateNavigationRef.current = true;
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Save scroll position on scroll (debounced)
  useEffect(() => {
    let scrollTimeout: ReturnType<typeof setTimeout>;

    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        try {
          const stored = sessionStorage.getItem(ROUTE_STORAGE_KEY);
          if (stored) {
            const persisted: PersistedRoute = JSON.parse(stored);
            persisted.scrollY = window.scrollY;
            persisted.timestamp = Date.now();
            sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(persisted));
          }
        } catch {
          // Ignore scroll save errors
        }
      }, 100);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(scrollTimeout);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);
}
