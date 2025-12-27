import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Crown, Target, Zap, Brain, Lock, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function EliteHitterPaywall() {
  const [isLoading, setIsLoading] = useState(false);
  const { startEliteHitterCheckout } = useSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    
    setIsLoading(true);
    try {
      await startEliteHitterCheckout();
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: Target, text: 'AI-curated 3-leg parlays daily' },
    { icon: Brain, text: 'Multi-engine consensus (MedianLock, HitRate, Sharp, PVS)' },
    { icon: Zap, text: '15%+ combined probability threshold' },
    { icon: Crown, text: 'Edge calculations & quality scoring' },
  ];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-primary/10 overflow-hidden relative">
      {/* Lock overlay */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm z-10 flex items-center justify-center">
        <div className="text-center space-y-4 p-6">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Unlock Daily Elite 3-Leg Hitter</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Get AI-powered daily parlays with multi-engine consensus
            </p>
          </div>
          
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold text-primary">$9.99</span>
            <span className="text-muted-foreground">/month</span>
          </div>
          
          <Button 
            onClick={handleSubscribe} 
            disabled={isLoading}
            className="w-full max-w-xs"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Crown className="w-4 h-4 mr-2" />
                Subscribe Now
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Blurred preview content */}
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-5 h-5 text-primary" />
            Daily Elite 3-Leg Hitter
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Today
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-3">
        {/* Preview legs - blurred */}
        {[1, 2, 3].map((idx) => (
          <div 
            key={idx} 
            className="p-3 rounded-lg bg-muted/30 border border-border/50 blur-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">🏀</span>
                  <span className="font-medium text-sm">Player Name</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    OVER
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Points 24.5 (-110)
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-green-500">72%</div>
                <div className="text-[10px] text-muted-foreground">+8.5% edge</div>
              </div>
            </div>
          </div>
        ))}

        {/* Features list */}
        <div className="mt-6 space-y-2 pt-4 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            What's Included
          </p>
          {features.map((feature, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <feature.icon className="w-4 h-4 text-primary shrink-0" />
              <span className="text-muted-foreground">{feature.text}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
