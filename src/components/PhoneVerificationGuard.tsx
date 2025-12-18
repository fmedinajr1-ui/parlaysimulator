import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';

interface PhoneVerificationGuardProps {
  children: ReactNode;
}

// Public paths that don't require verification
const PUBLIC_PATHS = ['/', '/auth', '/verify-email', '/verify-phone', '/install', '/offline'];

export function PhoneVerificationGuard({ children }: PhoneVerificationGuardProps) {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [verificationStatus, setVerificationStatus] = useState<{
    emailVerified: boolean | null;
    phoneVerified: boolean | null;
  }>({ emailVerified: null, phoneVerified: null });
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkVerification = async () => {
      if (!user) {
        setIsChecking(false);
        setVerificationStatus({ emailVerified: true, phoneVerified: true }); // Don't block unauthenticated users
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
          setVerificationStatus({ emailVerified: true, phoneVerified: true });
          setIsChecking(false);
          return;
        }

        // Check both email and phone verification for non-admin users
        const { data, error } = await supabase
          .from('profiles')
          .select('email_verified, phone_verified')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking verification:', error);
          // On error, redirect to verify page for safety
          setVerificationStatus({ emailVerified: false, phoneVerified: false });
        } else {
          setVerificationStatus({
            emailVerified: data?.email_verified ?? false,
            phoneVerified: data?.phone_verified ?? false
          });
        }
      } catch (err) {
        console.error('Error checking verification:', err);
        // On error, redirect to verify page for safety
        setVerificationStatus({ emailVerified: false, phoneVerified: false });
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

  // Check verification status - email first, then phone
  if (user) {
    if (verificationStatus.emailVerified === false) {
      return <Navigate to="/verify-email" replace state={{ from: location }} />;
    }
    if (verificationStatus.phoneVerified === false) {
      return <Navigate to="/verify-phone" replace state={{ from: location }} />;
    }
  }

  return <>{children}</>;
}
