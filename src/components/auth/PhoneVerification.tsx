import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, Phone, ArrowLeft, CheckCircle2, Bug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

interface PhoneVerificationProps {
  userId: string;
  onVerified: () => void;
  onBack?: () => void;
}

// Enable debug mode for development (shows verification code in UI)
const DEBUG_MODE = true;

export function PhoneVerification({ userId, onVerified, onBack }: PhoneVerificationProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const haptics = useHapticFeedback();

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

  const formatPhoneNumber = (value: string) => {
    // Remove non-digits
    const digits = value.replace(/\D/g, '');
    // Format as (XXX) XXX-XXXX for US numbers
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const getFullPhoneNumber = () => {
    const digits = phoneNumber.replace(/\D/g, '');
    return `${countryCode}${digits}`;
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

    const fullPhone = getFullPhoneNumber();
    
    // Basic validation
    const digits = phoneNumber.replace(/\D/g, '');
    if (digits.length < 10) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid 10-digit phone number.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setDebugCode(null);

    try {
      console.log('[PhoneVerification] Sending code to:', fullPhone);
      
      const { data, error } = await supabase.functions.invoke('send-phone-verification', {
        body: { 
          phone_number: fullPhone,
          debug_mode: DEBUG_MODE 
        }
      });

      console.log('[PhoneVerification] Response:', { data, error });

      if (error) {
        console.error('[PhoneVerification] Function error:', error);
        throw error;
      }
      
      // Handle rate limit with already sent code
      if (data?.alreadySent) {
        setStep('otp');
        setCooldown(data.waitTime || 60);
        toast({
          title: "Code Already Sent",
          description: `A code was recently sent. Please wait ${data.waitTime || 60} seconds before requesting a new one.`,
        });
        return;
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }

      // Check for debug code
      if (data?.debug_code) {
        setDebugCode(data.debug_code);
        console.log('[PhoneVerification] DEBUG CODE:', data.debug_code);
      }

      setStep('otp');
      setCooldown(30); // Reduced cooldown
      setExpiresIn(600); // 10 minutes
      haptics.success();
      
      toast({
        title: "Code Sent!",
        description: `Verification code sent to ${formatPhoneNumber(phoneNumber)}`,
      });
    } catch (err: any) {
      console.error('[PhoneVerification] Error:', err);
      haptics.error();
      
      // Handle rate limit error
      if (err.message?.includes('wait')) {
        const waitMatch = err.message.match(/(\d+) seconds/);
        if (waitMatch) {
          setCooldown(parseInt(waitMatch[1]));
          setStep('otp');
        }
      }
      // Handle already registered phone number
      if (err.message?.includes('already') && err.message?.includes('created')) {
        toast({
          title: "Account Already Exists",
          description: "An account with this phone number has already been created. Please sign in instead.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to Send Code",
          description: err.message || "Please try again.",
          variant: "destructive",
        });
      }
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
      console.log('[PhoneVerification] Verifying code:', otp);
      
      const { data, error } = await supabase.functions.invoke('verify-phone-code', {
        body: { 
          phone_number: getFullPhoneNumber(),
          code: otp,
          user_id: userId
        }
      });

      console.log('[PhoneVerification] Verify response:', { data, error });

      if (error) {
        console.error('[PhoneVerification] Verify error:', error);
        haptics.error();
        throw error;
      }
      
      // Check if we need a new code (expired)
      if (data?.needsNewCode) {
        setOtp('');
        setCooldown(0); // Allow immediate resend
        haptics.warning();
        toast({
          title: "Code Expired ⏰",
          description: "Your verification code has expired. Tap 'Resend code' to get a new one.",
          variant: "destructive",
        });
        return;
      }
      
      // Check for attempts remaining
      if (data?.attemptsRemaining !== undefined && data?.error) {
        setOtp('');
        haptics.error();
        const attemptsLeft = data.attemptsRemaining;
        toast({
          title: attemptsLeft === 0 
            ? "No Attempts Remaining" 
            : `Incorrect Code (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`,
          description: attemptsLeft === 0 
            ? "Please request a new code." 
            : "Please check your code and try again.",
          variant: "destructive",
        });
        if (attemptsLeft === 0) {
          setCooldown(0); // Allow immediate resend
        }
        return;
      }
      
      if (data?.error) {
        throw new Error(data.error);
      }

      haptics.success();
      toast({
        title: "Phone Verified! ✓",
        description: "Your account is now set up.",
      });
      
      onVerified();
    } catch (err: any) {
      console.error('[PhoneVerification] Verification failed:', err);
      haptics.error();
      
      // Parse error message for specific scenarios
      const errMsg = err.message || "";
      
      if (errMsg.includes('already registered') || errMsg.includes('already claimed')) {
        toast({
          title: "Phone Already Registered",
          description: "This phone number is linked to another account. Use a different number.",
          variant: "destructive",
        });
      } else if (errMsg.includes('rate limit') || errMsg.includes('too many')) {
        toast({
          title: "Too Many Attempts",
          description: "Please wait a few minutes before trying again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Verification Failed",
          description: errMsg || "Invalid code. Please try again.",
          variant: "destructive",
        });
      }
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

  if (step === 'phone') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Phone className="w-8 h-8 text-primary" />
          </div>
          <h2 className="font-display text-2xl mb-2">Verify Your Phone</h2>
          <p className="text-muted-foreground text-sm">
            We'll send you a verification code to confirm your identity. One phone number per account.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Phone Number</Label>
            <div className="flex gap-2">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-24 h-10 rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="+1">🇺🇸 +1</option>
                <option value="+44">🇬🇧 +44</option>
                <option value="+61">🇦🇺 +61</option>
                <option value="+91">🇮🇳 +91</option>
                <option value="+86">🇨🇳 +86</option>
              </select>
              <Input
                type="tel"
                placeholder="(555) 123-4567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(formatPhoneNumber(e.target.value))}
                className="flex-1 bg-card"
                maxLength={14}
              />
            </div>
          </div>

          <Button
            onClick={handleSendCode}
            className="w-full gradient-fire"
            disabled={isLoading || phoneNumber.replace(/\D/g, '').length < 10}
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
          We sent a 6-digit code to {formatPhoneNumber(phoneNumber)}
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
          onClick={() => { setStep('phone'); setOtp(''); setDebugCode(null); }}
          className="flex items-center justify-center gap-2 w-full text-muted-foreground hover:text-foreground text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Change phone number
        </button>
      </div>
    </div>
  );
}
