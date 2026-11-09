import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Small UI state only; never stores credentials or research data. */
export function useRememberedDeskState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const storageKey = `desk-ui-v1:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return initial;
      const saved = JSON.parse(raw);
      if (initial === null) return typeof saved === "string" || saved === null ? saved : initial;
      if (typeof saved !== typeof initial || saved === null) return initial;
      if (typeof initial === "object") {
        for (const [field, defaultValue] of Object.entries(initial as object)) {
          if (typeof saved[field] !== typeof defaultValue) return initial;
        }
      }
      return saved;
    } catch { return initial; }
  });

  useEffect(() => {
    const save = () => {
      try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Storage can be unavailable. */ }
    };
    save();
    const onHidden = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", save);
    };
  }, [storageKey, value]);

  return [value, setValue];
}