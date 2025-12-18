import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';

interface PhoneVerificationGuardProps {
  children: ReactNode;
}

// Public paths that don't require verification
const PUBLIC_PATHS = ['/', '/auth', '/verify-phone', '/install', '/offline'];

export function PhoneVerificationGuard({ children }: PhoneVerificationGuardProps) {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkVerification = async () => {
      if (!user) {
        setIsChecking(false);
        setPhoneVerified(true); // Don't block unauthenticated users
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
          setPhoneVerified(true);
          setIsChecking(false);
          return;
        }

        // Check phone verification for non-admin users
        const { data, error } = await supabase
          .from('profiles')
          .select('phone_verified')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking verification:', error);
          setPhoneVerified(false);
        } else {
          setPhoneVerified(data?.phone_verified ?? false);
        }
      } catch (err) {
        console.error('Error checking verification:', err);
        setPhoneVerified(false);
      } finally {
        setIsChecking(false);
      }
    };

    // Reset checking state when user changes
    setIsChecking(true);
    
    if (!authLoading) {
      checkVerification();
    }
  }, [user, authLoading]);

  // Still loading
  if (authLoading || isChecking) {
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

  // Check phone verification status
  if (user && phoneVerified === false) {
    return <Navigate to="/verify-phone" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
