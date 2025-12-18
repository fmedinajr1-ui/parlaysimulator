import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, Mail, ArrowLeft, CheckCircle2, Bug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface EmailVerificationProps {
  userId: string;
  defaultEmail?: string;
  onVerified: () => void;
  onBack?: () => void;
}

// Enable debug mode for development (shows verification code in UI)
const DEBUG_MODE = true;

export function EmailVerification({ userId, defaultEmail, onVerified, onBack }: EmailVerificationProps) {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState(defaultEmail || '');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [debugCode, setDebugCode] = useState<string | null>(null);

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  // Expiry countdown
  useEffect(() => {
    if (expiresIn > 0) {
      const timer = setTimeout(() => setExpiresIn(expiresIn - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [expiresIn]);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSendCode = async () => {
    // Prevent sending if still in cooldown
    if (cooldown > 0) {
      toast({
        title: "Please Wait",
        description: `You can request a new code in ${cooldown} seconds.`,
        variant: "destructive",
      });
      return;
    }

    if (!isValidEmail(email)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setDebugCode(null);

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
        console.error('[EmailVerification] Function error:', error);
        throw error;
      }

      // Handle already verified case
      if (data?.alreadyVerified) {
        toast({
          title: "Already Verified! ✓",
          description: "This email is already verified on your account.",
        });
        onVerified();
        return;
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }

      // Check for debug code
      if (data?.debug_code) {
        setDebugCode(data.debug_code);
        console.log('[EmailVerification] DEBUG CODE:', data.debug_code);
      }

      setStep('otp');
      setCooldown(30);
      setExpiresIn(600); // 10 minutes
      
      toast({
        title: "Code Sent!",
        description: `Verification code sent to ${email}`,
      });
    } catch (err: any) {
      console.error('[EmailVerification] Error:', err);
      
      // Handle rate limit error
      if (err.message?.includes('wait')) {
        const waitMatch = err.message.match(/(\d+) seconds/);
        if (waitMatch) {
          setCooldown(parseInt(waitMatch[1]));
          setStep('otp');
        }
      }
      toast({
        title: "Failed to Send Code",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (otp.length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter the 6-digit code.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      console.log('[EmailVerification] Verifying code:', otp);
      
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
        throw error;
      }
      
      // Check if we need a new code
      if (data?.needsNewCode) {
        setOtp('');
        setCooldown(0); // Allow immediate resend
        toast({
          title: "Code Expired",
          description: data.error || "Please request a new code.",
          variant: "destructive",
        });
        return;
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }

      toast({
        title: "Email Verified! ✓",
        description: "Moving to phone verification...",
      });
      
      onVerified();
    } catch (err: any) {
      console.error('[EmailVerification] Verification failed:', err);
      toast({
        title: "Verification Failed",
        description: err.message || "Invalid code. Please try again.",
        variant: "destructive",
      });
      setOtp('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (cooldown > 0) return;
    setDebugCode(null);
    await handleSendCode();
  };

  const handleUseDebugCode = () => {
    if (debugCode) {
      setOtp(debugCode);
    }
  };

  if (step === 'email') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-primary" />
          </div>
          <h2 className="font-display text-2xl mb-2">Verify Your Email</h2>
          <p className="text-muted-foreground text-sm">
            We'll send you a verification code to confirm your email address.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email Address</Label>
            <Input
              type="email"
              placeholder="degen@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-card"
            />
          </div>

          <Button
            onClick={handleSendCode}
            className="w-full gradient-fire"
            disabled={isLoading || !isValidEmail(email)}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              'Send Verification Code'
            )}
          </Button>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center justify-center gap-2 w-full text-muted-foreground hover:text-foreground text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign up
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <h2 className="font-display text-2xl mb-2">Enter Code</h2>
        <p className="text-muted-foreground text-sm">
          We sent a 6-digit code to {email}
        </p>
        {expiresIn > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Code expires in {Math.floor(expiresIn / 60)}:{(expiresIn % 60).toString().padStart(2, '0')}
          </p>
        )}
      </div>

      {/* Debug mode code display */}
      {DEBUG_MODE && debugCode && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
          <div className="flex items-center justify-center gap-2 text-yellow-600 text-xs mb-1">
            <Bug className="w-3 h-3" />
            <span>DEBUG MODE</span>
          </div>
          <p className="text-sm text-foreground">
            Your code is: <strong className="font-mono text-lg">{debugCode}</strong>
          </p>
          <button
            type="button"
            onClick={handleUseDebugCode}
            className="text-xs text-primary hover:underline mt-1"
          >
            Auto-fill code
          </button>
        </div>
      )}

      <div className="flex justify-center">
        <InputOTP
          value={otp}
          onChange={setOtp}
          maxLength={6}
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

      <div className="space-y-3">
        <Button
          onClick={handleVerifyCode}
          className="w-full gradient-fire"
          disabled={isLoading || otp.length !== 6}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            'Verify Code'
          )}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResendCode}
            disabled={cooldown > 0 || isLoading}
            className="text-sm text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => { setStep('email'); setOtp(''); setDebugCode(null); }}
          className="flex items-center justify-center gap-2 w-full text-muted-foreground hover:text-foreground text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Change email address
        </button>
      </div>
    </div>
  );
}
