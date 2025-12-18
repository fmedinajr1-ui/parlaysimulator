import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EmailVerification } from '@/components/auth/EmailVerification';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';
import { supabase } from '@/integrations/supabase/client';

const VerifyEmail = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  // Prevent back navigation during verification
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      window.history.pushState(null, '', window.location.href);
    };
    
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Check if user is admin or already email verified
  useEffect(() => {
    const checkUserStatus = async () => {
      if (!user) {
        setCheckingStatus(false);
        return;
      }

      try {
        // Check if user is admin (bypass verification)
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .single();

        if (roleData) {
          // Admin users bypass verification
          navigate('/');
          return;
        }

        // Check if already email verified
        const { data: profile } = await supabase
          .from('profiles')
          .select('email_verified')
          .eq('user_id', user.id)
          .single();

        if (profile?.email_verified) {
          setIsEmailVerified(true);
          // If email is verified, go to phone verification
          navigate('/verify-phone');
          return;
        }
      } catch (error) {
        console.error('Error checking user status:', error);
      } finally {
        setCheckingStatus(false);
      }
    };

    if (!isLoading) {
      checkUserStatus();
    }
  }, [user, isLoading, navigate]);

  const handleVerified = () => {
    // After email verification, proceed to phone verification
    navigate('/verify-phone');
  };

  if (isLoading || checkingStatus) {
    return <FullPageWolfLoader />;
  }

  if (!user) {
    navigate('/auth');
    return null;
  }

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4 pb-nav-safe">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <CardTitle className="font-display text-2xl">Email Verification</CardTitle>
          <CardDescription>
            Verify your email to secure your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailVerification
            userId={user.id}
            defaultEmail={user.email}
            onVerified={handleVerified}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default VerifyEmail;
