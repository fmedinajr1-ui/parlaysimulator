import { useEffect, useRef } from 'react';

/**
 * Hook to detect when the app goes to background/foreground.
 * Useful for saving state immediately when Safari PWA is backgrounded.
 * 
 * @param onVisible - Called when app returns to foreground
 * @param onHidden - Called when app goes to background
 */
export function useVisibilityChange(
  onVisible?: () => void,
  onHidden?: () => void
) {
  const onVisibleRef = useRef(onVisible);
  const onHiddenRef = useRef(onHidden);

  // Update refs when callbacks change
  useEffect(() => {
    onVisibleRef.current = onVisible;
    onHiddenRef.current = onHidden;
  }, [onVisible, onHidden]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        onHiddenRef.current?.();
      } else if (document.visibilityState === 'visible') {
        onVisibleRef.current?.();
      }
    };

    // Also handle iOS-specific events
    const handlePageHide = () => {
      onHiddenRef.current?.();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      // persisted means it was restored from bfcache
      if (event.persisted) {
        onVisibleRef.current?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);
}

/**
 * Hook that saves state immediately when app is backgrounded
 */
export function useSaveOnBackground(saveCallback: () => void) {
  useVisibilityChange(undefined, saveCallback);
}
