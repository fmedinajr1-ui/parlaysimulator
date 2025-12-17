import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

interface PhoneVerificationGuardProps {
  children: ReactNode;
}

// Public paths that don't require phone verification
const PUBLIC_PATHS = ['/', '/auth', '/verify-phone', '/install', '/offline'];

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
        // Check if user is admin first - admins bypass phone verification
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        if (roleData) {
          // User is admin, bypass phone verification
          setIsVerified(true);
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
          console.error('Error checking phone verification:', error);
          // On error, redirect to verify page for safety
          setIsVerified(false);
        } else {
          setIsVerified(data?.phone_verified ?? false);
        }
      } catch (err) {
        console.error('Error checking phone verification:', err);
        // On error, redirect to verify page for safety
        setIsVerified(false);
      } finally {
        setIsChecking(false);
      }
    };

    // Reset checking state when user changes
    setIsChecking(true);
    
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

  // Check if current path is public
  const isPublicPath = PUBLIC_PATHS.some(p => 
    location.pathname === p || 
    (p !== '/' && location.pathname.startsWith(p))
  );

  // Allow access to public paths
  if (isPublicPath) {
    return <>{children}</>;
  }

  // Not verified - redirect to verify page
  if (user && isVerified === false) {
    return <Navigate to="/verify-phone" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
