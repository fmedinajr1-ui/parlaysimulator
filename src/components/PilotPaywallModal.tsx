import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Zap, Shield, Lock, Package } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface PilotPaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchase: (packType: 'single' | 'pack20' | 'pack50') => void;
  freeScansUsed?: number;
}

export function PilotPaywallModal({ isOpen, onClose, onPurchase, freeScansUsed = 5 }: PilotPaywallModalProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handlePurchase = (packType: 'single' | 'pack20' | 'pack50') => {
    if (!user) {
      navigate('/auth');
      onClose();
      return;
    }
    onPurchase(packType);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md mx-4">
        <DialogHeader className="text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <DialogTitle className="font-display text-2xl text-gradient-fire">
            FREE SCANS USED
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            You've used all {freeScansUsed} of your free parlay scans
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {/* Single Scan */}
          <button
            onClick={() => handlePurchase('single')}
            className="w-full rounded-lg border border-border bg-card p-4 text-left hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-semibold">Single Scan</p>
                  <p className="text-xs text-muted-foreground">1 parlay analysis</p>
                </div>
              </div>
              <span className="text-xl font-bold text-primary">$1</span>
            </div>
          </button>

          {/* 20 Pack */}
          <button
            onClick={() => handlePurchase('pack20')}
            className="w-full rounded-lg border-2 border-primary bg-primary/5 p-4 text-left hover:bg-primary/10 transition-colors relative"
          >
            <div className="absolute -top-2 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold rounded">
              SAVE $5
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-semibold">20 Scan Pack</p>
                  <p className="text-xs text-muted-foreground">$0.75 per scan</p>
                </div>
              </div>
              <span className="text-xl font-bold text-primary">$15</span>
            </div>
          </button>

          {/* 50 Pack */}
          <button
            onClick={() => handlePurchase('pack50')}
            className="w-full rounded-lg border border-border bg-card p-4 text-left hover:border-primary/50 transition-colors relative"
          >
            <div className="absolute -top-2 left-4 px-2 py-0.5 bg-accent text-accent-foreground text-xs font-bold rounded">
              BEST VALUE
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-accent" />
                <div>
                  <p className="font-semibold">50 Scan Pack</p>
                  <p className="text-xs text-muted-foreground">$0.80 per scan - Save $10!</p>
                </div>
              </div>
              <span className="text-xl font-bold text-primary">$40</span>
            </div>
          </button>
        </div>

        {/* Features */}
        <div className="space-y-2 text-sm border-t pt-4">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            <span>AI-powered slip extraction</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            <span>Monte Carlo simulations</span>
          </div>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-primary" />
            <span>AI roasts & analysis</span>
          </div>
        </div>

        {/* Trust badges */}
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-2">
          <div className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            <span>Secure payment</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            <span>Instant access</span>
          </div>
        </div>

        <Button variant="ghost" onClick={onClose} className="w-full mt-2">
          Maybe later
        </Button>
      </DialogContent>
    </Dialog>
  );
}
