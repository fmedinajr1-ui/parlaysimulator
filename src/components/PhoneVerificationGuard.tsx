import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface PhoneVerificationGuardProps {
  children: ReactNode;
}

export function PhoneVerificationGuard({ children }: PhoneVerificationGuardProps) {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkPhoneVerification = async () => {
      if (!user) {
        setIsChecking(false);
        setIsVerified(true); // Don't block unauthenticated users
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('phone_verified')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking phone verification:', error);
          setIsVerified(true); // Don't block on error
        } else {
          setIsVerified(data?.phone_verified ?? false);
        }
      } catch (err) {
        console.error('Error checking phone verification:', err);
        setIsVerified(true); // Don't block on error
      } finally {
        setIsChecking(false);
      }
    };

    if (!authLoading) {
      checkPhoneVerification();
    }
  }, [user, authLoading]);

  // Still loading
  if (authLoading || isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Allow access to auth and verify-phone pages
  const publicPaths = ['/auth', '/verify-phone', '/'];
  if (publicPaths.some(p => location.pathname.startsWith(p) && p !== '/' || location.pathname === p)) {
    return <>{children}</>;
  }

  // Not verified - redirect to verify page
  if (user && isVerified === false) {
    // Use replaceState to prevent back-button bypass
    window.history.replaceState(null, '', '/verify-phone');
    return <Navigate to="/verify-phone" replace />;
  }

  return <>{children}</>;
}
