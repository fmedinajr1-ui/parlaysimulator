// Subscription hook - manages user subscription state
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface SubscriptionState {
  isLoading: boolean;
  isSubscribed: boolean;
  isAdmin: boolean;
  canScan: boolean;
  scansRemaining: number;
  subscriptionEnd: string | null;
  hasBotAccess: boolean;
}

export function useSubscription() {
  const { user, session } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    isLoading: true,
    isSubscribed: false,
    isAdmin: false,
    canScan: true,
    scansRemaining: 3,
    subscriptionEnd: null,
    hasBotAccess: false,
  });

  const checkSubscription = useCallback(async () => {
    if (!user || !session) {
      setState({
        isLoading: false,
        isSubscribed: false,
        isAdmin: false,
        canScan: true,
        scansRemaining: 3,
        subscriptionEnd: null,
        hasBotAccess: false,
      });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('check-subscription');

      if (error) {
        console.error('Error checking subscription:', error);
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      setState({
        isLoading: false,
        isSubscribed: data.subscribed || false,
        isAdmin: data.isAdmin || false,
        canScan: data.canScan ?? true,
        scansRemaining: data.scansRemaining ?? 3,
        subscriptionEnd: data.subscriptionEnd || null,
        hasBotAccess: data.hasBotAccess || false,
      });
    } catch (err) {
      console.error('Error checking subscription:', err);
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, [user, session]);

  const incrementScan = useCallback(async () => {
    if (!user || !session) return;
    if (state.isAdmin || state.isSubscribed) return;

    try {
      await supabase.functions.invoke('increment-scan');
      await checkSubscription();
    } catch (err) {
      console.error('Error incrementing scan:', err);
    }
  }, [user, session, state.isAdmin, state.isSubscribed, checkSubscription]);

  const startCheckout = useCallback(async () => {
    if (!user || !session) return;

    try {
      const { data, error } = await supabase.functions.invoke('create-checkout');

      if (error) {
        console.error('Error creating checkout:', error);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Error starting checkout:', err);
    }
  }, [user, session]);

  const openCustomerPortal = useCallback(async () => {
    if (!user || !session) return;

    try {
      const { data, error } = await supabase.functions.invoke('customer-portal');

      if (error) {
        console.error('Error opening customer portal:', error);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Error opening customer portal:', err);
    }
  }, [user, session]);

  const startBotCheckout = useCallback(async () => {
    if (!user || !session) return;

    try {
      const { data, error } = await supabase.functions.invoke('create-bot-checkout');

      if (error) {
        console.error('Error creating bot checkout:', error);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Error starting bot checkout:', err);
    }
  }, [user, session]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  useEffect(() => {
    const handleFocus = () => {
      checkSubscription();
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [checkSubscription]);

  return {
    ...state,
    checkSubscription,
    incrementScan,
    startCheckout,
    openCustomerPortal,
    startBotCheckout,
  };
}
