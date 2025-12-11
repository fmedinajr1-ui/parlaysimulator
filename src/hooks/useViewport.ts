// Viewport hook - device size and safe area detection
import { useState, useEffect } from 'react';

interface ViewportInfo {
  width: number;
  height: number;
  isSmallPhone: boolean;    // iPhone SE, iPhone 8
  isMediumPhone: boolean;   // iPhone 12/13/14
  isLargePhone: boolean;    // iPhone Plus/Pro Max
  hasNotch: boolean;
  isLandscape: boolean;
  safeAreaTop: number;
  safeAreaBottom: number;
}

export function useViewport(): ViewportInfo {
  const [viewport, setViewport] = useState<ViewportInfo>(() => getViewportInfo());

  useEffect(() => {
    const handleResize = () => {
      setViewport(getViewportInfo());
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // Also listen for viewport changes on mobile (keyboard open, etc.)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  return viewport;
}

function getViewportInfo(): ViewportInfo {
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Detect notch by checking safe area inset
  const computedStyle = getComputedStyle(document.documentElement);
  const safeAreaTop = parseInt(computedStyle.getPropertyValue('--sat') || '0', 10) || 
                      getSafeAreaValue('safe-area-inset-top');
  const safeAreaBottom = parseInt(computedStyle.getPropertyValue('--sab') || '0', 10) || 
                         getSafeAreaValue('safe-area-inset-bottom');

  const hasNotch = safeAreaTop > 20 || safeAreaBottom > 20;

  return {
    width,
    height,
    isSmallPhone: width <= 375,           // iPhone SE, 8
    isMediumPhone: width > 375 && width <= 393,  // iPhone 12/13/14
    isLargePhone: width > 393,            // iPhone Plus/Pro Max
    hasNotch,
    isLandscape: width > height,
    safeAreaTop,
    safeAreaBottom,
  };
}

function getSafeAreaValue(property: string): number {
  // Create a temporary element to measure safe area inset
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.paddingTop = `env(${property}, 0px)`;
  document.body.appendChild(el);
  const value = parseInt(getComputedStyle(el).paddingTop, 10) || 0;
  document.body.removeChild(el);
  return value;
}
