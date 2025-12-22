import { useState, useEffect, useCallback } from 'react';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

interface DeviceInfo {
  fingerprint: string;
  userAgent: string;
}

export const useDeviceFingerprint = () => {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getFingerprint = async () => {
      try {
        setIsLoading(true);
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        
        setDeviceInfo({
          fingerprint: result.visitorId,
          userAgent: navigator.userAgent
        });
        setError(null);
      } catch (err) {
        console.error('Error getting device fingerprint:', err);
        setError('Failed to get device fingerprint');
        // Generate a fallback fingerprint based on available browser info
        const fallback = btoa(navigator.userAgent + navigator.language + screen.width + screen.height).slice(0, 32);
        setDeviceInfo({
          fingerprint: fallback,
          userAgent: navigator.userAgent
        });
      } finally {
        setIsLoading(false);
      }
    };

    getFingerprint();
  }, []);

  const refreshFingerprint = useCallback(async () => {
    try {
      setIsLoading(true);
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      
      setDeviceInfo({
        fingerprint: result.visitorId,
        userAgent: navigator.userAgent
      });
      setError(null);
    } catch (err) {
      console.error('Error refreshing device fingerprint:', err);
      setError('Failed to refresh device fingerprint');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    deviceInfo,
    isLoading,
    error,
    refreshFingerprint
  };
};
