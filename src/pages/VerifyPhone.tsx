import { useEffect, useState } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PhoneVerification } from '@/components/auth/PhoneVerification';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';

export default function VerifyPhone() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoading } = useAuth();
  const [isVerified, setIsVerified] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  
  // Check if test mode is enabled via query param
  const isTestMode = searchParams.get('test') === 'true';

  // Use replaceState to prevent back-button bypass
  useEffect(() => {
    const path = isTestMode ? '/verify-phone?test=true' : '/verify-phone';
    window.history.replaceState(null, '', path);
  }, [isTestMode]);

  // Check if already verified or if user is admin
  useEffect(() => {
    const checkVerification = async () => {
      if (!user) {
        setChecking(false);
        return;
      }

      try {
        // Check if user is admin - admins bypass phone verification (unless in test mode)
        if (!isTestMode) {
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .eq('role', 'admin')
            .maybeSingle();

          if (roleData) {
            // User is admin, redirect to home
            navigate('/', { replace: true });
            return;
          }
        }

        // Check phone verification for non-admin users
        const { data } = await supabase
          .from('profiles')
          .select('phone_verified')
          .eq('user_id', user.id)
          .maybeSingle();

        const verified = data?.phone_verified ?? false;
        setIsVerified(verified);
        
        if (verified) {
          navigate('/', { replace: true });
        }
      } catch (err) {
        console.error('Error checking verification:', err);
      } finally {
        setChecking(false);
      }
    };

    if (!isLoading && user) {
      checkVerification();
    } else if (!isLoading && !user) {
      setChecking(false);
    }
  }, [user, isLoading, navigate]);

  const handleVerified = () => {
    setIsVerified(true);
    navigate('/', { replace: true });
  };

  // Show loader while auth is loading
  if (isLoading) {
    return <FullPageWolfLoader text="Loading..." />;
  }

  // Redirect to auth if not logged in
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Show loader while checking verification status
  if (checking) {
    return <FullPageWolfLoader text="Checking verification..." />;
  }

  return (
    <AppShell>
      <div className="max-w-md mx-auto mt-8 px-4">
        <Card className="border-primary/20">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Verify Your Phone</CardTitle>
            <CardDescription>
              Complete phone verification to access all features. This helps us keep the platform secure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PhoneVerification
              userId={user.id}
              onVerified={handleVerified}
              onBack={() => navigate('/auth?mode=signup')}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
