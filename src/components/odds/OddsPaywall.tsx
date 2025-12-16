import { useState } from 'react';
import { Lock, TrendingUp, Zap, Eye, Mail, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WolfAvatar } from '@/components/avatars/WolfAvatar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface OddsPaywallProps {
  onSubscribe?: () => void;
}

export function OddsPaywall({ onSubscribe }: OddsPaywallProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const { toast } = useToast();

  const handleSubscribe = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-odds-checkout');
      
      if (error) throw error;
      
      if (data?.url) {
        // Use location.href for better mobile/PWA experience
        window.location.href = data.url;
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

  const features = [
    { icon: TrendingUp, label: 'Live Line Movements', desc: 'Track every line shift in real-time', color: 'text-primary' },
    { icon: Zap, label: 'Sharp Money Alerts', desc: 'Know where the sharps are betting', color: 'text-neon-yellow' },
    { icon: Eye, label: 'Unlimited Tracking', desc: 'Monitor all props and movements', color: 'text-neon-green' },
  ];

  return (
    <div className="min-h-[50vh] flex flex-col p-4">
      <Card className="flex-1 max-w-md w-full mx-auto border-primary/30 bg-gradient-to-b from-card to-card/50">
        <CardContent className="p-4 sm:p-6 flex flex-col h-full">
          {/* Compact Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-shrink-0">
              <WolfAvatar size="md" variant="alpha" animated />
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                <Lock size={10} className="text-primary-foreground" />
              </div>
            </div>
            <div className="text-left">
              <h2 className="font-display text-xl text-foreground">ODDS TRACKER PRO</h2>
              <p className="text-muted-foreground text-xs">Real-time odds intelligence</p>
            </div>
          </div>

          {/* Collapsible Features */}
          <div className="space-y-2 mb-4">
            {/* Always show first feature */}
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
              <TrendingUp className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-sm font-medium">3 Pro Features Included</span>
              <button 
                onClick={() => setShowAllFeatures(!showAllFeatures)}
                className="ml-auto p-1 hover:bg-muted rounded"
              >
                {showAllFeatures ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
            
            {/* Expandable features */}
            <div className={cn(
              "space-y-2 overflow-hidden transition-all duration-300",
              showAllFeatures ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
            )}>
              {features.map((feature) => (
                <div key={feature.label} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/30">
                  <feature.icon className={cn("w-4 h-4 flex-shrink-0", feature.color)} />
                  <div>
                    <p className="text-sm font-medium">{feature.label}</p>
                    <p className="text-xs text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Compact Price */}
          <div className="flex items-center justify-center gap-2 py-3 border-y border-border mb-4">
            <span className="text-3xl font-display text-foreground">$99</span>
            <span className="text-muted-foreground text-sm">/month</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Sticky CTA Area */}
          <div className="space-y-2 sticky bottom-0 bg-card pt-2">
            <Button 
              onClick={handleSubscribe}
              disabled={isLoading}
              className="w-full h-11 font-display text-base bg-primary hover:bg-primary/90"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'UNLOCK ODDS TRACKER'
              )}
            </Button>
            
            <button
              onClick={handleContactAdmin}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 w-full py-2"
            >
              <Mail size={12} />
              Request admin approval
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
