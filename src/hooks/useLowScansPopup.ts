import { useState, useCallback, useEffect } from 'react';

const COOLDOWN_KEY = 'low-scans-popup-dismissed';
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export function useLowScansPopup() {
  const [isOpen, setIsOpen] = useState(false);

  // Check if we should show the popup (not in cooldown)
  const canShow = useCallback(() => {
    const lastDismissed = sessionStorage.getItem(COOLDOWN_KEY);
    if (!lastDismissed) return true;
    
    const elapsed = Date.now() - parseInt(lastDismissed, 10);
    return elapsed > COOLDOWN_MS;
  }, []);

  // Trigger the popup if conditions are met
  const triggerIfLow = useCallback((scansRemaining: number) => {
    if (scansRemaining <= 2 && canShow()) {
      setIsOpen(true);
    }
  }, [canShow]);

  // Dismiss with cooldown
  const dismiss = useCallback(() => {
    setIsOpen(false);
    sessionStorage.setItem(COOLDOWN_KEY, Date.now().toString());
  }, []);

  // Close without cooldown (for purchase action)
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return {
    isOpen,
    triggerIfLow,
    dismiss,
    close,
  };
}
