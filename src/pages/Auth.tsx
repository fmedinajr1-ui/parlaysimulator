import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PhoneVerification } from '@/components/auth/PhoneVerification';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { Loader2, Mail, Lock, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';

const authSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255, 'Email too long'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72, 'Password too long')
});

type AuthStep = 'credentials' | 'phone-verification';

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>('credentials');
  const [newUserId, setNewUserId] = useState<string | null>(null);
  const { signIn, signUp, user, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnUrl = searchParams.get('return') || '/profile';

  useEffect(() => {
    if (!isLoading && user) {
      // Check if user needs phone verification (for new signups)
      if (authStep === 'credentials') {
        navigate(returnUrl);
      }
    }
  }, [user, isLoading, navigate, authStep, returnUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate inputs
    const result = authSchema.safeParse({ email, password });
    if (!result.success) {
      toast({
        title: "Validation Error",
        description: result.error.errors[0].message,
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (isLogin) {
        const { error } = await signIn(email, password);
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            toast({
              title: "Login Failed",
              description: "Invalid email or password. Check your credentials and try again.",
              variant: "destructive"
            });
          } else {
            toast({
              title: "Login Failed",
              description: error.message,
              variant: "destructive"
            });
          }
        } else {
          toast({
            title: "Welcome back! 🔥",
            description: "Ready to analyze some degenerate bets?"
          });
          navigate(returnUrl);
        }
      } else {
        const { error, data } = await signUp(email, password);
        if (error) {
          if (error.message.includes('User already registered')) {
            toast({
              title: "Account Exists",
              description: "This email is already registered. Try logging in instead.",
              variant: "destructive"
            });
          } else {
            toast({
              title: "Signup Failed",
              description: error.message,
              variant: "destructive"
            });
          }
        } else if (data?.user) {
          // New user created, proceed to phone verification
          setNewUserId(data.user.id);
          setAuthStep('phone-verification');
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneVerified = () => {
    toast({
      title: "Account Created! 🎉",
      description: "Welcome to the degen club."
    });
    navigate(returnUrl);
  };

  const handleBackToCredentials = () => {
    setAuthStep('credentials');
    setNewUserId(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Phone verification step for new signups
  if (authStep === 'phone-verification' && newUserId) {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe">
        <div className="max-w-md mx-auto px-4 py-8">
          <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>

          <PhoneVerification
            userId={newUserId}
            onVerified={handlePhoneVerified}
            onBack={handleBackToCredentials}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background pb-nav-safe">
      <div className="max-w-md mx-auto px-4 py-8">
        {/* Back button */}
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl text-foreground mb-2">
            {isLogin ? 'WELCOME BACK' : 'JOIN THE CLUB'}
          </h1>
          <p className="text-muted-foreground">
            {isLogin ? 'Login to track your degen history' : 'Create an account to save your slips'}
          </p>
        </div>

        {/* Auth form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="degen@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 bg-card border-border"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 bg-card border-border"
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            variant="neon"
            size="lg"
            className="w-full font-display"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isLogin ? 'LOGGING IN...' : 'CREATING ACCOUNT...'}
              </>
            ) : (
              isLogin ? '🔥 LOGIN' : '🎟️ SIGN UP'
            )}
          </Button>
        </form>

        {/* Toggle */}
        <div className="mt-6 text-center">
          <p className="text-muted-foreground">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
          </p>
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-primary hover:underline font-semibold mt-1"
          >
            {isLogin ? 'Create one' : 'Login instead'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
