import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * A hook that persists state to sessionStorage, surviving Safari PWA backgrounding.
 * State is automatically saved on every change and restored on mount.
 * 
 * Enhanced with defensive checks for mobile PWA environments where
 * React context may not be fully initialized during lazy loading.
 * 
 * @param key - Storage key for this state
 * @param initialValue - Default value if nothing is stored
 * @param maxAgeMs - Optional: max age in milliseconds before state is considered stale (default: 30 minutes)
 */
export function usePersistedState<T>(
  key: string,
  initialValue: T,
  maxAgeMs: number = 30 * 60 * 1000
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  // Track if component is mounted to prevent updates after unmount
  const mountedRef = useRef(true);
  const isInitializedRef = useRef(false);

  // Safe initialization with comprehensive error handling
  const [state, setState] = useState<T>(() => {
    try {
      // Check if we're in a browser environment
      if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
        return initialValue;
      }

      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        const { value, timestamp } = parsed;
        
        // Check if stored value is still fresh
        if (timestamp && Date.now() - timestamp < maxAgeMs) {
          isInitializedRef.current = true;
          return value as T;
        }
        
        // Stale data, remove it
        try {
          sessionStorage.removeItem(key);
        } catch {
          // Ignore removal errors
        }
      }
    } catch (error) {
      // Log but don't crash - return initial value instead
      console.warn(`[usePersistedState] Failed to restore state for ${key}:`, error);
    }
    
    isInitializedRef.current = true;
    return initialValue;
  });

  // Safe setState wrapper that checks mount status
  const safeSetState = useCallback<React.Dispatch<React.SetStateAction<T>>>((value) => {
    if (mountedRef.current) {
      setState(value);
    }
  }, []);

  // Persist state on every change with error handling
  useEffect(() => {
    // Skip initial persistence if we just loaded from storage
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(key, JSON.stringify({
          value: state,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.warn(`[usePersistedState] Failed to persist state for ${key}:`, error);
    }
  }, [key, state]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Clear persisted state with error handling
  const clearPersistedState = useCallback(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`[usePersistedState] Failed to clear state for ${key}:`, error);
    }
  }, [key]);

  return [state, safeSetState, clearPersistedState];
}

/**
 * Check if there's restored state available without loading it
 */
export function hasPersistedState(key: string, maxAgeMs: number = 30 * 60 * 1000): boolean {
  try {
    if (typeof sessionStorage === 'undefined') {
      return false;
    }
    
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const { timestamp } = JSON.parse(stored);
      return timestamp && Date.now() - timestamp < maxAgeMs;
    }
  } catch {
    // Ignore errors
  }
  return false;
}
