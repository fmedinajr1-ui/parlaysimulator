import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, Phone, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface PhoneVerificationProps {
  userId: string;
  onVerified: () => void;
  onBack?: () => void;
}

export function PhoneVerification({ userId, onVerified, onBack }: PhoneVerificationProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);

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

    try {
      const { data, error } = await supabase.functions.invoke('send-phone-verification', {
        body: { phone_number: fullPhone }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setStep('otp');
      setCooldown(60);
      setExpiresIn(data.expiresIn || 300);
      
      toast({
        title: "Code Sent! 📱",
        description: `Verification code sent to ${formatPhoneNumber(phoneNumber)}`,
      });
    } catch (err: any) {
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
      const { data, error } = await supabase.functions.invoke('verify-phone-code', {
        body: { 
          phone_number: getFullPhoneNumber(),
          code: otp,
          user_id: userId
        }
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      toast({
        title: "Phone Verified! ✅",
        description: "Your account is now set up.",
      });
      
      onVerified();
    } catch (err: any) {
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
    await handleSendCode();
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
          onClick={() => { setStep('phone'); setOtp(''); }}
          className="flex items-center justify-center gap-2 w-full text-muted-foreground hover:text-foreground text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Change phone number
        </button>
      </div>
    </div>
  );
}
