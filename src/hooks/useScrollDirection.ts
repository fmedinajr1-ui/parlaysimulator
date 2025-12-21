import { useState, useEffect, useCallback } from 'react';

interface ScrollDirectionState {
  direction: 'up' | 'down' | null;
  isAtTop: boolean;
  isVisible: boolean;
}

export function useScrollDirection(threshold = 10): ScrollDirectionState {
  const [state, setState] = useState<ScrollDirectionState>({
    direction: null,
    isAtTop: true,
    isVisible: true,
  });

  const handleScroll = useCallback(() => {
    const currentScrollY = window.scrollY;
    const isAtTop = currentScrollY < 10;
    
    // Check if page has scrollable content (with buffer for iOS bounce)
    const hasScrollableContent = document.documentElement.scrollHeight > window.innerHeight + 50;

    setState((prev) => {
      // Always show at top or if no scrollable content
      if (isAtTop || !hasScrollableContent) {
        return { direction: null, isAtTop: true, isVisible: true };
      }

      // Get previous scroll position from closure
      const prevScrollY = (window as any).__prevScrollY || 0;
      const diff = currentScrollY - prevScrollY;

      // Store current position for next comparison
      (window as any).__prevScrollY = currentScrollY;

      // Only update if we've scrolled past threshold
      if (Math.abs(diff) < threshold) {
        return prev;
      }

      const direction = diff > 0 ? 'down' : 'up';
      const isVisible = direction === 'up' || isAtTop;

      return { direction, isAtTop, isVisible };
    });
  }, [threshold]);

  useEffect(() => {
    (window as any).__prevScrollY = window.scrollY;
    
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [handleScroll]);

  return state;
}
