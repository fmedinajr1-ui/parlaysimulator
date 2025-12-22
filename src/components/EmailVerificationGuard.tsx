import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';

interface EmailVerificationGuardProps {
  children: ReactNode;
}

// Public paths that don't require verification - include /profile for sign-out access
const PUBLIC_PATHS = ['/', '/auth', '/verify-email', '/install', '/offline', '/profile'];

export function EmailVerificationGuard({ children }: EmailVerificationGuardProps) {
  const { user, isLoading: authLoading } = useAuth();
  const location = useLocation();
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

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
          setEmailVerified(false);
        } else {
          setEmailVerified(data?.email_verified ?? false);
        }
      } catch (err) {
        console.error('Error checking verification:', err);
        setEmailVerified(false);
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

  // Check email verification status
  if (user && emailVerified === false) {
    return <Navigate to="/verify-email" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
