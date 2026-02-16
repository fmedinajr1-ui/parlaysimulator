import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDeviceFingerprint } from '@/hooks/useDeviceFingerprint';
import { useLocation } from 'react-router-dom';

export const trackEvent = async (
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

export function useTimeOnPage(pagePath: string) {
  const { user } = useAuth();
  const { deviceInfo } = useDeviceFingerprint();
  const startTimeRef = useRef(Date.now());
  const accumulatedRef = useRef(0);
  const visibleRef = useRef(true);

  useEffect(() => {
    startTimeRef.current = Date.now();
    accumulatedRef.current = 0;
    visibleRef.current = true;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleRef.current) {
          accumulatedRef.current += (Date.now() - startTimeRef.current) / 1000;
          visibleRef.current = false;
        }
      } else {
        startTimeRef.current = Date.now();
        visibleRef.current = true;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (visibleRef.current) {
        accumulatedRef.current += (Date.now() - startTimeRef.current) / 1000;
      }
      const duration = Math.round(accumulatedRef.current);
      if (duration > 1) {
        trackEvent('time_on_page', pagePath, user?.id, deviceInfo?.fingerprint, {
          duration_seconds: duration,
        });
      }
    };
  }, [pagePath, user?.id, deviceInfo?.fingerprint]);
}

export function useSectionView(sectionId: string) {
  const { user } = useAuth();
  const { deviceInfo } = useDeviceFingerprint();
  const location = useLocation();
  const trackedRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    trackedRef.current = false;
  }, [location.pathname]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !trackedRef.current) {
          trackedRef.current = true;
          trackEvent('section_view', location.pathname, user?.id, deviceInfo?.fingerprint, {
            section: sectionId,
          });
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [sectionId, location.pathname, user?.id, deviceInfo?.fingerprint]);

  return ref;
}
