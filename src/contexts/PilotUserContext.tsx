import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  phoneVerified: boolean;
  isPurchasing: boolean;
}

interface PilotUserContextType extends PilotUserState {
  checkStatus: () => Promise<void>;
  decrementScan: (quotaType?: 'scan' | 'compare') => Promise<{ success: boolean; error?: string; unlimited?: boolean }>;
  purchaseScans: (packType: 'single' | 'pack10' | 'pack20' | 'pack50') => Promise<void>;
  creditScans: (scans: number) => Promise<void>;
}

const defaultState: PilotUserState = {
  isLoading: true,
  isPilotUser: true,
  isAdmin: false,
  isSubscribed: false,
  canScan: true,
  freeScansRemaining: 5,
  freeComparesRemaining: 3,
  paidScanBalance: 0,
  totalScansAvailable: 5,
  phoneVerified: false,
  isPurchasing: false,
};

const PilotUserContext = createContext<PilotUserContextType | null>(null);

export function PilotUserProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [isPurchasing, setIsPurchasing] = useState(false);
  const lastFocusCheck = useRef<number>(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pilot-user', user?.id],
    queryFn: async () => {
      if (!user || !session) {
        return {
          isPilotUser: true,
          isAdmin: false,
          subscribed: false,
          canScan: true,
          freeScansRemaining: 5,
          freeComparesRemaining: 3,
          paidScanBalance: 0,
          phoneVerified: false,
        };
      }

      const { data, error } = await supabase.functions.invoke('check-subscription');
      
      if (error) {
        console.error('Error checking pilot status:', error);
        throw error;
      }
      
      return data;
    },
    enabled: true,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  useEffect(() => {
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusCheck.current > 30000) {
        lastFocusCheck.current = now;
        refetch();
      }
    };
    
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refetch]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`pilot-quota-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pilot_user_quotas',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newData = payload.new as {
            free_scans_remaining?: number;
            free_compares_remaining?: number;
            paid_scan_balance?: number;
          };

          if (newData) {
            queryClient.setQueryData(['pilot-user', user.id], (old: any) => ({
              ...old,
              freeScansRemaining: newData.free_scans_remaining ?? old?.freeScansRemaining ?? 0,
              freeComparesRemaining: newData.free_compares_remaining ?? old?.freeComparesRemaining ?? 0,
              paidScanBalance: newData.paid_scan_balance ?? old?.paidScanBalance ?? 0,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const checkStatus = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const decrementScan = useCallback(async (quotaType: 'scan' | 'compare' = 'scan') => {
    if (!user || !session) return { success: false, error: 'Not authenticated' };
    
    const isAdmin = data?.isAdmin || false;
    const isSubscribed = data?.subscribed || false;
    
    if (isAdmin || isSubscribed) return { success: true, unlimited: true };

    try {
      const { data: result, error } = await supabase.functions.invoke('decrement-pilot-scan', {
        body: { quotaType },
      });

      if (error) {
        console.error('Error decrementing scan:', error);
        return { success: false, error: error.message };
      }

      return result;
    } catch (err) {
      console.error('Error decrementing scan:', err);
      return { success: false, error: 'Failed to decrement scan' };
    }
  }, [user, session, data?.isAdmin, data?.subscribed]);

  const purchaseScans = useCallback(async (packType: 'single' | 'pack10' | 'pack20' | 'pack50') => {
    if (!user || !session) return;

    setIsPurchasing(true);

    try {
      const { data: result, error } = await supabase.functions.invoke('purchase-scans', {
        body: { packType },
      });

      if (error) {
        console.error('Error purchasing scans:', error);
        setIsPurchasing(false);
        return;
      }

      if (result?.url) {
        window.location.href = result.url;
      } else {
        setIsPurchasing(false);
      }
    } catch (err) {
      console.error('Error purchasing scans:', err);
      setIsPurchasing(false);
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
    } catch (err) {
      console.error('Error crediting scans:', err);
    }
  }, [user, session]);

  const freeScans = data?.freeScansRemaining ?? 5;
  const paidScans = data?.paidScanBalance ?? 0;

  const state: PilotUserContextType = {
    isLoading,
    isPilotUser: data?.isPilotUser ?? true,
    isAdmin: data?.isAdmin ?? false,
    isSubscribed: data?.subscribed ?? false,
    canScan: data?.canScan ?? true,
    freeScansRemaining: freeScans,
    freeComparesRemaining: data?.freeComparesRemaining ?? 3,
    paidScanBalance: paidScans,
    totalScansAvailable: freeScans + paidScans,
    phoneVerified: data?.phoneVerified ?? false,
    isPurchasing,
    checkStatus,
    decrementScan,
    purchaseScans,
    creditScans,
  };

  return (
    <PilotUserContext.Provider value={state}>
      {children}
    </PilotUserContext.Provider>
  );
}

export function usePilotUserContext() {
  const context = useContext(PilotUserContext);
  if (!context) {
    throw new Error('usePilotUserContext must be used within a PilotUserProvider');
  }
  return context;
}

export { PilotUserContext };
