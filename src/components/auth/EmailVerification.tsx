import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Mail, ArrowLeft, Loader2, CheckCircle } from 'lucide-react';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

interface EmailVerificationProps {
  userId: string;
  userEmail?: string;
  onVerified: () => void;
  onBack?: () => void;
}

const DEBUG_MODE = true;

export function EmailVerification({ userId, userEmail, onVerified, onBack }: EmailVerificationProps) {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState(userEmail || '');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const haptic = useHapticFeedback();

  // Countdown for cooldown
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setInterval(() => {
        setCooldown(prev => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldown]);

  // Countdown for code expiration
  useEffect(() => {
    if (expiresAt) {
      const timer = setInterval(() => {
        const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
        setTimeRemaining(remaining);
        if (remaining === 0) {
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [expiresAt]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      toast.error('Please enter your email address');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    haptic.mediumTap();

    try {
      console.log('[EmailVerification] Sending code to:', email);
      
      const { data, error } = await supabase.functions.invoke('send-email-verification', {
        body: { 
          email: email.toLowerCase(),
          debug_mode: DEBUG_MODE
        }
      });

      console.log('[EmailVerification] Response:', { data, error });

      if (error) {
        console.error('[EmailVerification] Error:', error);
        toast.error(error.message || 'Failed to send verification code');
        return;
      }

      if (data?.error) {
        if (data.cooldown) {
          setCooldown(data.cooldown);
          toast.error(data.error);
        } else {
          toast.error(data.error);
        }
        return;
      }

      if (data?.alreadyVerified) {
        toast.success('Email already verified!');
        onVerified();
        return;
      }

      // Store debug code if provided
      if (data?.debug_code) {
        setDebugCode(data.debug_code);
        console.log('[EmailVerification] Debug code received');
      }

      // Set expiration timer
      if (data?.expiresInSeconds) {
        setExpiresAt(new Date(Date.now() + data.expiresInSeconds * 1000));
        setTimeRemaining(data.expiresInSeconds);
      }

      toast.success('Verification code sent to your email');
      setStep('otp');
      haptic.success();
    } catch (err) {
      console.error('[EmailVerification] Exception:', err);
      toast.error('Failed to send verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (otp.length !== 6) {
      toast.error('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    haptic.mediumTap();

    try {
      console.log('[EmailVerification] Verifying code');
      
      const { data, error } = await supabase.functions.invoke('verify-email-code', {
        body: {
          email: email.toLowerCase(),
          code: otp,
          user_id: userId
        }
      });

      console.log('[EmailVerification] Verify response:', { data, error });

      if (error) {
        console.error('[EmailVerification] Verify error:', error);
        toast.error(error.message || 'Failed to verify code');
        return;
      }

      if (data?.error) {
        if (data.needsNewCode) {
          toast.error(data.error);
          setStep('email');
          setOtp('');
          setDebugCode(null);
        } else {
          toast.error(data.error);
          if (data.attemptsRemaining !== undefined) {
            toast.warning(`${data.attemptsRemaining} attempts remaining`);
          }
        }
        return;
      }

      if (data?.success) {
        toast.success('Email verified successfully!');
        haptic.success();
        onVerified();
      }
    } catch (err) {
      console.error('[EmailVerification] Verify exception:', err);
      toast.error('Failed to verify code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setOtp('');
    setDebugCode(null);
    await handleSendCode();
  };

  const handleUseDebugCode = () => {
    if (debugCode) {
      setOtp(debugCode);
      haptic.lightTap();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (step === 'email') {
    return (
      <div className="space-y-6">
        {onBack && (
          <Button 
            variant="ghost" 
            onClick={onBack}
            className="pl-0 hover:bg-transparent"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="w-4 h-4" />
            <span>We'll send a verification code to your email</span>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Email Address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="w-full"
              disabled={isLoading}
            />
          </div>

          <Button
            onClick={handleSendCode}
            disabled={isLoading || cooldown > 0 || !email.trim()}
            className="w-full"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : cooldown > 0 ? (
              `Wait ${cooldown}s`
            ) : (
              'Send Verification Code'
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button 
        variant="ghost" 
        onClick={() => {
          setStep('email');
          setOtp('');
          setDebugCode(null);
        }}
        className="pl-0 hover:bg-transparent"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Change email
      </Button>

      <div className="space-y-4">
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code sent to
          </p>
          <p className="font-medium">{email}</p>
          {timeRemaining > 0 && (
            <p className="text-xs text-muted-foreground">
              Code expires in {formatTime(timeRemaining)}
            </p>
          )}
        </div>

        {DEBUG_MODE && debugCode && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Debug Mode - Your code:</p>
            <button
              onClick={handleUseDebugCode}
              className="font-mono text-xl font-bold text-primary hover:underline cursor-pointer"
            >
              {debugCode}
            </button>
            <p className="text-xs text-muted-foreground mt-1">Click to auto-fill</p>
          </div>
        )}

        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={otp}
            onChange={setOtp}
            disabled={isLoading}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button
          onClick={handleVerifyCode}
          disabled={isLoading || otp.length !== 6}
          className="w-full"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Verify Code
            </>
          )}
        </Button>

        <div className="text-center">
          <button
            onClick={handleResendCode}
            disabled={isLoading || cooldown > 0}
            className="text-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Didn't receive code? Resend"}
          </button>
        </div>
      </div>
    </div>
  );
}
