import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDeviceFingerprint } from '@/hooks/useDeviceFingerprint';
import { useLocation } from 'react-router-dom';

const trackEvent = async (
  eventType: string,
  pagePath: string,
  userId?: string,
  deviceFingerprint?: string,
  metadata?: Record<string, string | number | boolean>
) => {
  try {
    await supabase.from('analytics_events').insert([{
      event_type: eventType,
      page_path: pagePath,
      user_id: userId || undefined,
      device_fingerprint: deviceFingerprint || null,
      user_agent: navigator.userAgent,
      referrer: document.referrer || null,
      metadata: metadata || {},
    }]);
  } catch (err) {
    console.error('Analytics tracking error:', err);
  }
};

export function usePageView() {
  const { user } = useAuth();
  const { deviceInfo } = useDeviceFingerprint();
  const location = useLocation();
  const lastTrackedPath = useRef('');

  useEffect(() => {
    const path = location.pathname;
    if (path === lastTrackedPath.current) return;
    lastTrackedPath.current = path;

    trackEvent('page_view', path, user?.id, deviceInfo?.fingerprint);
  }, [location.pathname, user?.id, deviceInfo?.fingerprint]);
}

export function useTrackClick() {
  const { user } = useAuth();
  const { deviceInfo } = useDeviceFingerprint();
  const location = useLocation();

  return useCallback(
    (clickType: string, metadata?: Record<string, string | number | boolean>) => {
      trackEvent(
        clickType,
        location.pathname,
        user?.id,
        deviceInfo?.fingerprint,
        metadata
      );
    },
    [user?.id, deviceInfo?.fingerprint, location.pathname]
  );
}
