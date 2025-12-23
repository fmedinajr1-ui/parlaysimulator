import { useContext } from 'react';
import { PilotUserContext, usePilotUserContext } from '@/contexts/PilotUserContext';

/**
 * Hook to access pilot user state and actions.
 * Uses centralized React Query caching to prevent duplicate API calls.
 * 
 * This is a backward-compatible wrapper around PilotUserContext.
 * All components using this hook share the same cached data.
 */
export function usePilotUser() {
  const context = useContext(PilotUserContext);
  
  // If used outside provider (e.g., during initial render), return safe defaults
  if (!context) {
    return {
      isLoading: true,
      isPilotUser: true,
      isAdmin: false,
      isSubscribed: false,
      canScan: true,
      freeScansRemaining: 5,
      freeComparesRemaining: 3,
      paidScanBalance: 0,
      totalScansAvailable: 5,
      hasOddsAccess: false,
      hasEliteAccess: false,
      phoneVerified: false,
      isPurchasing: false,
      checkStatus: async () => {},
      decrementScan: async () => ({ success: false, error: 'Context not available' }),
      purchaseScans: async () => {},
      creditScans: async () => {},
    };
  }
  
  return context;
}
