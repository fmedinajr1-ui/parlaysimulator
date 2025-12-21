import { useEffect } from 'react';
import { saveCurrentRoute } from './useRoutePersistence';

/**
 * Hook that handles page lifecycle events for mobile PWA optimization.
 * Saves state before the page is frozen/hidden and helps with bfcache restoration.
 */
export function usePageLifecycle() {
  useEffect(() => {
    // Handle visibility change (works on all browsers)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Save state immediately when going to background
        saveCurrentRoute();
      }
    };

    // Handle pagehide (Safari iOS - fires before page is killed)
    const handlePageHide = (event: PageTransitionEvent) => {
      // Always save state on pagehide
      saveCurrentRoute();
      
      // If page is being persisted to bfcache, we're good
      if (event.persisted) {
        // Page will be restored from bfcache
        return;
      }
    };

    // Handle pageshow (Safari iOS - fires when page is restored)
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // Page was restored from bfcache
        // Force a repaint to ensure UI is visible
        document.documentElement.style.backgroundColor = '';
        requestAnimationFrame(() => {
          document.documentElement.classList.add('bfcache-restored');
          requestAnimationFrame(() => {
            document.documentElement.classList.remove('bfcache-restored');
          });
        });
      }
    };

    // Handle freeze event (Chrome - page is being frozen)
    const handleFreeze = () => {
      saveCurrentRoute();
    };

    // Handle resume event (Chrome - page is being resumed)
    const handleResume = () => {
      // Force repaint after resume
      requestAnimationFrame(() => {
        document.documentElement.classList.add('resumed');
        requestAnimationFrame(() => {
          document.documentElement.classList.remove('resumed');
        });
      });
    };

    // Handle beforeunload as last resort
    const handleBeforeUnload = () => {
      saveCurrentRoute();
    };

    // Add all event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // These are Chrome-specific but safe to add
    document.addEventListener('freeze', handleFreeze);
    document.addEventListener('resume', handleResume);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('freeze', handleFreeze);
      document.removeEventListener('resume', handleResume);
    };
  }, []);
}
