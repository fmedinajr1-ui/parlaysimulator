import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface PushNotificationState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  permission: NotificationPermission | 'default';
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    permission: 'default',
  });

  // Check if push notifications are supported
  useEffect(() => {
    const checkSupport = async () => {
      const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
      const permission = isSupported ? Notification.permission : 'default';
      
      setState(prev => ({
        ...prev,
        isSupported,
        permission,
        isLoading: false,
      }));

      if (isSupported && permission === 'granted') {
        checkExistingSubscription();
      }
    };

    checkSupport();
  }, []);

  const checkExistingSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      setState(prev => ({
        ...prev,
        isSubscribed: !!subscription,
      }));
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  };

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', registration);
      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      throw error;
    }
  };

  const getVapidKey = async (): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: { action: 'getVapidKey' },
    });

    if (error) throw error;
    return data.vapidPublicKey;
  };

  const subscribe = useCallback(async (sportsFilter: string[] = [], sharpOnly = true) => {
    if (!state.isSupported) {
      toast.error('Push notifications are not supported in your browser');
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      // Request permission
      const permission = await Notification.requestPermission();
      setState(prev => ({ ...prev, permission }));

      if (permission !== 'granted') {
        toast.error('Notification permission denied');
        setState(prev => ({ ...prev, isLoading: false }));
        return false;
      }

      // Register service worker
      const registration = await registerServiceWorker();

      // Get VAPID public key
      const vapidPublicKey = await getVapidKey();

      // Convert VAPID key to Uint8Array
      const urlBase64ToUint8Array = (base64String: string) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      };

      // Subscribe to push notifications
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subscriptionJson = subscription.toJSON();

      // Save subscription to backend
      const { error } = await supabase.functions.invoke('send-push-notification', {
        body: {
          action: 'subscribe',
          subscription: {
            endpoint: subscriptionJson.endpoint,
            keys: subscriptionJson.keys,
            userId: user?.id,
            sportsFilter,
            sharpOnly,
          },
        },
      });

      if (error) throw error;

      setState(prev => ({ ...prev, isSubscribed: true, isLoading: false }));
      toast.success('Push notifications enabled!');
      return true;
    } catch (error: any) {
      console.error('Error subscribing to push:', error);
      toast.error('Failed to enable notifications');
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, [state.isSupported, user?.id]);

  const unsubscribe = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();

        await supabase.functions.invoke('send-push-notification', {
          body: {
            action: 'unsubscribe',
            subscription: { endpoint: subscription.endpoint },
          },
        });
      }

      setState(prev => ({ ...prev, isSubscribed: false, isLoading: false }));
      toast.success('Push notifications disabled');
      return true;
    } catch (error: any) {
      console.error('Error unsubscribing:', error);
      toast.error('Failed to disable notifications');
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
  };
}
