import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface PilotUserState {
  isLoading: boolean;
  isPilotUser: boolean;
  isAdmin: boolean;
  isSubscribed: boolean;
  canScan: boolean;
  freeScansRemaining: number;
  freeComparesRemaining: number;
  paidScanBalance: number;
  totalScansAvailable: number;
  hasOddsAccess: boolean;
}

export function usePilotUser() {
  const { user, session } = useAuth();
  const [state, setState] = useState<PilotUserState>({
    isLoading: true,
    isPilotUser: true, // Default to restricted until confirmed
    isAdmin: false,
    isSubscribed: false,
    canScan: true,
    freeScansRemaining: 5,
    freeComparesRemaining: 3,
    paidScanBalance: 0,
    totalScansAvailable: 5,
    hasOddsAccess: false,
  });

  const checkStatus = useCallback(async () => {
    if (!user || !session) {
      setState({
        isLoading: false,
        isPilotUser: true, // Restrict unauthenticated users by default
        isAdmin: false,
        isSubscribed: false,
        canScan: true,
        freeScansRemaining: 5,
        freeComparesRemaining: 3,
        paidScanBalance: 0,
        totalScansAvailable: 5,
        hasOddsAccess: false,
      });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('check-subscription');

      if (error) {
        console.error('Error checking pilot status:', error);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      setState({
        isLoading: false,
        isPilotUser: data.isPilotUser || false,
        isAdmin: data.isAdmin || false,
        isSubscribed: data.subscribed || false,
        canScan: data.canScan ?? true,
        freeScansRemaining: data.freeScansRemaining ?? 5,
        freeComparesRemaining: data.freeComparesRemaining ?? 3,
        paidScanBalance: data.paidScanBalance ?? 0,
        totalScansAvailable: (data.freeScansRemaining ?? 0) + (data.paidScanBalance ?? 0),
        hasOddsAccess: data.hasOddsAccess || false,
      });
    } catch (err) {
      console.error('Error checking pilot status:', err);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [user, session]);

  const decrementScan = useCallback(async (quotaType: 'scan' | 'compare' = 'scan') => {
    if (!user || !session) return { success: false, error: 'Not authenticated' };
    if (state.isAdmin || state.isSubscribed) return { success: true, unlimited: true };

    try {
      const { data, error } = await supabase.functions.invoke('decrement-pilot-scan', {
        body: { quotaType },
      });

      if (error) {
        console.error('Error decrementing scan:', error);
        return { success: false, error: error.message };
      }

      // Refresh status after decrement
      await checkStatus();
      return data;
    } catch (err) {
      console.error('Error decrementing scan:', err);
      return { success: false, error: 'Failed to decrement scan' };
    }
  }, [user, session, state.isAdmin, state.isSubscribed, checkStatus]);

  const purchaseScans = useCallback(async (packType: 'single' | 'pack20' | 'pack50') => {
    if (!user || !session) return;

    try {
      const { data, error } = await supabase.functions.invoke('purchase-scans', {
        body: { packType },
      });

      if (error) {
        console.error('Error purchasing scans:', error);
        return;
      }

      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (err) {
      console.error('Error purchasing scans:', err);
    }
  }, [user, session]);

  const creditScans = useCallback(async (scans: number) => {
    if (!user || !session) return;

    try {
      const { error } = await supabase.functions.invoke('credit-scan-purchase', {
        body: { scans },
      });

      if (error) {
        console.error('Error crediting scans:', error);
        return;
      }

      // Refresh status after credit
      await checkStatus();
    } catch (err) {
      console.error('Error crediting scans:', err);
    }
  }, [user, session, checkStatus]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Refresh on window focus
  useEffect(() => {
    const handleFocus = () => checkStatus();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkStatus]);

  return {
    ...state,
    checkStatus,
    decrementScan,
    purchaseScans,
    creditScans,
  };
}
