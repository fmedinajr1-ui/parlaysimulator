// Haptic feedback hook - mobile vibration patterns
type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' | 'tabSwitch';

const patterns: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [10, 50, 10],
  warning: [30, 50, 30],
  error: [50, 100, 50],
  selection: 5,
  tabSwitch: [3, 30, 8], // iOS-style quick tap for tab switching
};

// Simple vibrate function - no hooks needed
const vibrate = (pattern: HapticPattern = 'light') => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(patterns[pattern]);
    }
  } catch {
    // Silently fail if vibration not supported
  }
};

export function useHapticFeedback() {
  return {
    vibrate,
    lightTap: () => vibrate('light'),
    mediumTap: () => vibrate('medium'),
    heavyTap: () => vibrate('heavy'),
    success: () => vibrate('success'),
    warning: () => vibrate('warning'),
    error: () => vibrate('error'),
    selection: () => vibrate('selection'),
    tabSwitch: () => vibrate('tabSwitch'),
  };
}
