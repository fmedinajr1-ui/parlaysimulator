import { useState, useEffect, useCallback } from 'react';

/**
 * A hook that persists state to sessionStorage, surviving Safari PWA backgrounding.
 * State is automatically saved on every change and restored on mount.
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
  const [state, setState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const { value, timestamp } = JSON.parse(stored);
        // Check if stored value is still fresh
        if (Date.now() - timestamp < maxAgeMs) {
          return value as T;
        }
        // Stale data, remove it
        sessionStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`Failed to restore persisted state for ${key}:`, error);
    }
    return initialValue;
  });

  // Persist state on every change
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify({
        value: state,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn(`Failed to persist state for ${key}:`, error);
    }
  }, [key, state]);

  // Clear persisted state
  const clearPersistedState = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn(`Failed to clear persisted state for ${key}:`, error);
    }
  }, [key]);

  return [state, setState, clearPersistedState];
}

/**
 * Check if there's restored state available without loading it
 */
export function hasPersistedState(key: string, maxAgeMs: number = 30 * 60 * 1000): boolean {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const { timestamp } = JSON.parse(stored);
      return Date.now() - timestamp < maxAgeMs;
    }
  } catch {
    // Ignore errors
  }
  return false;
}
