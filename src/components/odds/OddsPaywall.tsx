import { useState } from 'react';
import { Lock, TrendingUp, Zap, Eye, Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WolfAvatar } from '@/components/avatars/WolfAvatar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface OddsPaywallProps {
  onSubscribe?: () => void;
}

export function OddsPaywall({ onSubscribe }: OddsPaywallProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-odds-checkout');
      
      if (error) throw error;
      
      if (data?.url) {
        window.open(data.url, '_blank');
        onSubscribe?.();
      }
    } catch (err) {
      console.error('Checkout error:', err);
      toast({
        title: 'Error',
        description: 'Failed to start checkout. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleContactAdmin = () => {
    toast({
      title: 'Request Submitted',
      description: 'Contact support to request access approval.',
    });
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-primary/30 bg-gradient-to-b from-card to-card/50">
        <CardContent className="p-6 text-center space-y-6">
          {/* Wolf Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <WolfAvatar size="lg" variant="alpha" animated />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                <Lock size={12} className="text-primary-foreground" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div>
            <h2 className="font-display text-2xl text-foreground">
              ODDS TRACKER PRO
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              Hunt like a wolf with real-time odds intelligence
            </p>
          </div>

          {/* Features */}
          <div className="space-y-3 text-left">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <TrendingUp className="w-5 h-5 text-primary flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Live Line Movements</p>
                <p className="text-xs text-muted-foreground">Track every line shift in real-time</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Zap className="w-5 h-5 text-neon-yellow flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Sharp Money Alerts</p>
                <p className="text-xs text-muted-foreground">Know where the sharps are betting</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Eye className="w-5 h-5 text-neon-green flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Unlimited Tracking</p>
                <p className="text-xs text-muted-foreground">Monitor all props and movements</p>
              </div>
            </div>
          </div>

          {/* Price */}
          <div className="py-4 border-y border-border">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-display text-foreground">$99</span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Cancel anytime • Instant access
            </p>
          </div>

          {/* CTA */}
          <div className="space-y-3">
            <Button 
              onClick={handleSubscribe}
              disabled={isLoading}
              className="w-full h-12 font-display text-lg bg-primary hover:bg-primary/90"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'UNLOCK ODDS TRACKER'
              )}
            </Button>
            
            <button
              onClick={handleContactAdmin}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 w-full"
            >
              <Mail size={12} />
              Request admin approval instead
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
