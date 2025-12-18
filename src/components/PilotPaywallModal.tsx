import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Zap, Shield, Lock, Package, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { cn } from '@/lib/utils';
import wolfLoaderImage from "@/assets/wolf-loader.png";

interface PilotPaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchase: (packType: 'single' | 'pack20' | 'pack50') => void;
  freeScansUsed?: number;
  isPurchasing?: boolean;
}

function PaywallContent({ onClose, onPurchase, freeScansUsed = 5, isPurchasing = false }: Omit<PilotPaywallModalProps, 'isOpen'>) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { mediumTap } = useHapticFeedback();

  const handlePurchase = (packType: 'single' | 'pack20' | 'pack50') => {
    mediumTap();
    if (!user) {
      navigate('/auth');
      onClose();
      return;
    }
    onPurchase(packType);
  };

  return (
    <div className="px-1">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-4 border border-primary/20">
          <img 
            src={wolfLoaderImage} 
            alt="Parlay Farm" 
            className="w-14 h-14 object-contain"
          />
        </div>
        <h2 className="font-display text-2xl font-bold text-gradient-fire mb-1">
          OUT OF SCANS
        </h2>
        <p className="text-sm text-muted-foreground">
          You've used all {freeScansUsed} free parlay scans
        </p>
      </div>

      {/* Purchase Options */}
      <div className="space-y-3 mb-6">
        {/* Single Scan */}
        <button
          onClick={() => handlePurchase('single')}
          disabled={isPurchasing}
          className={cn(
            "w-full rounded-xl border border-border bg-card p-4 text-left transition-all",
            "active:scale-[0.98] touch-manipulation",
            "hover:border-primary/50 hover:bg-card/80",
            isPurchasing && "opacity-50 pointer-events-none"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Single Scan</p>
                <p className="text-xs text-muted-foreground">1 parlay analysis</p>
              </div>
            </div>
            <span className="text-2xl font-bold text-primary">$1</span>
          </div>
        </button>

        {/* 20 Pack - Featured */}
        <button
          onClick={() => handlePurchase('pack20')}
          disabled={isPurchasing}
          className={cn(
            "w-full rounded-xl border-2 border-primary bg-primary/5 p-4 text-left transition-all relative",
            "active:scale-[0.98] touch-manipulation",
            "hover:bg-primary/10",
            isPurchasing && "opacity-50 pointer-events-none"
          )}
        >
          <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold rounded-full">
            SAVE $5
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-foreground">20 Scan Pack</p>
                <p className="text-xs text-muted-foreground">$0.75 per scan</p>
              </div>
            </div>
            <span className="text-2xl font-bold text-primary">$15</span>
          </div>
        </button>

        {/* 50 Pack */}
        <button
          onClick={() => handlePurchase('pack50')}
          disabled={isPurchasing}
          className={cn(
            "w-full rounded-xl border border-border bg-card p-4 text-left transition-all relative",
            "active:scale-[0.98] touch-manipulation",
            "hover:border-accent/50 hover:bg-card/80",
            isPurchasing && "opacity-50 pointer-events-none"
          )}
        >
          <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-accent text-accent-foreground text-xs font-bold rounded-full">
            BEST VALUE
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="font-semibold text-foreground">50 Scan Pack</p>
                <p className="text-xs text-muted-foreground">$0.80 per scan</p>
              </div>
            </div>
            <span className="text-2xl font-bold text-primary">$40</span>
          </div>
        </button>
      </div>

      {/* Loading indicator */}
      {isPurchasing && (
        <div className="flex items-center justify-center gap-2 mb-4 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Preparing checkout...</span>
        </div>
      )}

      {/* Features */}
      <div className="space-y-2 text-sm border-t border-border pt-4 mb-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check className="w-4 h-4 text-primary shrink-0" />
          <span>AI-powered slip extraction</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check className="w-4 h-4 text-primary shrink-0" />
          <span>Monte Carlo simulations</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Check className="w-4 h-4 text-primary shrink-0" />
          <span>AI roasts & analysis</span>
        </div>
      </div>

      {/* Trust badges */}
      <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground pb-2">
        <div className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          <span>Secure payment</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" />
          <span>Instant access</span>
        </div>
      </div>

      <Button variant="ghost" onClick={onClose} className="w-full h-11 text-muted-foreground">
        Maybe later
      </Button>
    </div>
  );
}

export function PilotPaywallModal({ isOpen, onClose, onPurchase, freeScansUsed = 5, isPurchasing = false }: PilotPaywallModalProps) {
  // Use Drawer on mobile for better UX
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={onClose}>
        <DrawerContent className="px-4 pb-8 pt-4">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Out of Scans</DrawerTitle>
            <DrawerDescription>Purchase more scans to continue</DrawerDescription>
          </DrawerHeader>
          <PaywallContent 
            onClose={onClose} 
            onPurchase={onPurchase} 
            freeScansUsed={freeScansUsed}
            isPurchasing={isPurchasing}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>Out of Scans</DialogTitle>
          <DialogDescription>Purchase more scans to continue</DialogDescription>
        </DialogHeader>
        <PaywallContent 
          onClose={onClose} 
          onPurchase={onPurchase} 
          freeScansUsed={freeScansUsed}
          isPurchasing={isPurchasing}
        />
      </DialogContent>
    </Dialog>
  );
}
