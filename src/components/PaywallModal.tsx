import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Check, Zap, TrendingUp, Shield, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubscribe: () => void;
  scansUsed?: number;
}

export function PaywallModal({ isOpen, onClose, onSubscribe, scansUsed = 3 }: PaywallModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = () => {
    if (!user) {
      navigate('/auth');
      onClose();
      return;
    }
    onSubscribe();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md mx-4">
        <DialogHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full gradient-fire flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-background" />
          </div>
          <DialogTitle className="font-display text-2xl text-gradient-fire">
            FREE SCANS USED
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            You've used all {scansUsed} of your free parlay scans
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Pricing Card */}
          <div className="rounded-xl border-2 border-primary/50 bg-primary/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-display text-xl">PRO ACCESS</h3>
                <p className="text-sm text-muted-foreground">Unlimited everything</p>
              </div>
              <div className="text-right">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-primary">$5</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary" />
                <span>Unlimited parlay scans</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary" />
                <span>AI-powered slip extraction</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary" />
                <span>Monte Carlo simulations</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary" />
                <span>Compare unlimited parlays</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-primary" />
                <span>AI roasts & analysis</span>
              </div>
            </div>
          </div>

          {/* CTA Button */}
          <Button 
            onClick={handleSubscribe}
            className="w-full gradient-fire font-display text-lg h-12"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            {user ? 'UPGRADE TO PRO' : 'SIGN IN TO UPGRADE'}
          </Button>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              <span>Secure payment</span>
            </div>
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              <span>Cancel anytime</span>
            </div>
          </div>
        </div>

        <Button variant="ghost" onClick={onClose} className="w-full">
          Maybe later
        </Button>
      </DialogContent>
    </Dialog>
  );
}
