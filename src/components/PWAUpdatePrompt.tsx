import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * PWAUpdatePrompt - Detects service worker updates and prompts user to refresh
 * This component listens for service worker controller changes and automatically
 * refreshes the page to load the latest version of the app.
 */
export function PWAUpdatePrompt() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Listen for controller change (new service worker activated)
    const handleControllerChange = () => {
      toast.info('App updated! Refreshing...', {
        duration: 2000,
      });
      setTimeout(() => window.location.reload(), 2000);
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Also check for waiting service workers on load
    navigator.serviceWorker.ready.then((registration) => {
      if (registration.waiting) {
        // There's a waiting service worker, tell it to activate
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Listen for new service workers
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker installed, prompt to refresh
              toast.info('New version available!', {
                action: {
                  label: 'Refresh',
                  onClick: () => window.location.reload(),
                },
                duration: 10000,
              });
            }
          });
        }
      });
    });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}

/**
 * Utility function to clear all PWA caches and force refresh
 * Can be called from anywhere in the app
 */
export async function clearPWACacheAndRefresh() {
  try {
    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }

    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }

    // Clear localStorage auth tokens
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('sb-') || key.includes('supabase')) {
        localStorage.removeItem(key);
      }
    });

    // Force reload
    window.location.reload();
  } catch (error) {
    console.error('[PWA] Error clearing cache:', error);
    window.location.reload();
  }
}
