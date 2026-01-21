import { ReactNode, useEffect, useState, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';

interface EmailVerificationGuardProps {
  children: ReactNode;
}

// Public paths that don't require verification - include /profile for sign-out access
const PUBLIC_PATHS = ['/', '/auth', '/verify-email', '/install', '/offline', '/profile', '/draft'];

// Max time to wait for verification check before allowing through
const VERIFICATION_TIMEOUT_MS = 5000;

export function EmailVerificationGuard({ children }: EmailVerificationGuardProps) {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Timeout fallback to prevent infinite loading
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      if (isChecking) {
        console.warn('[EmailVerificationGuard] Verification check timed out, allowing through');
        setTimedOut(true);
        setIsChecking(false);
        setEmailVerified(true); // Allow through on timeout
      }
    }, VERIFICATION_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const checkVerification = async () => {
      if (!user) {
        setIsChecking(false);
        setEmailVerified(true); // Don't block unauthenticated users
        return;
      }

      try {
        // Check if user is admin first - admins bypass all verification
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        if (roleData) {
          // User is admin, bypass verification
          setEmailVerified(true);
          setIsChecking(false);
          return;
        }

        // Check email verification for non-admin users
        const { data, error } = await supabase
          .from('profiles')
          .select('email_verified')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking verification:', error);
          // On error, allow through rather than blocking forever
          setEmailVerified(true);
        } else {
          setEmailVerified(data?.email_verified ?? false);
        }
      } catch (err) {
        console.error('Error checking verification:', err);
        // On error, allow through rather than blocking forever
        setEmailVerified(true);
      } finally {
        setIsChecking(false);
      }
    };

    // Reset checking state when user changes (but not on initial mount)
    if (!authLoading) {
      setIsChecking(true);
      checkVerification();
    }
  }, [user?.id, authLoading]);

  // Clear timeout when checking completes
  useEffect(() => {
    if (!isChecking && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, [isChecking]);

  // Still loading (but respect timeout)
  if ((authLoading || isChecking) && !timedOut) {
    return <FullPageWolfLoader />;
  }

  // Check if current path is public
  const isPublicPath = PUBLIC_PATHS.some(p => 
    location.pathname === p || 
    (p !== '/' && location.pathname.startsWith(p))
  );

  // Allow access to public paths
  if (isPublicPath) {
    return <>{children}</>;
  }

  // Check email verification status
  if (user && emailVerified === false) {
    return <Navigate to="/verify-email" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
