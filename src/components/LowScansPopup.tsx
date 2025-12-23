import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Package, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

interface LowScansPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onPurchase: (packType: 'pack10') => void;
  scansRemaining: number;
  isPurchasing?: boolean;
}

function PopupContent({ 
  onClose, 
  onDismiss, 
  onPurchase, 
  scansRemaining, 
  isPurchasing = false 
}: Omit<LowScansPopupProps, 'isOpen'>) {
  const { mediumTap } = useHapticFeedback();

  const handlePurchase = () => {
    mediumTap();
    onPurchase('pack10');
  };

  return (
    <div className="px-1 py-2">
      {/* Header */}
      <div className="text-center mb-5">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-yellow-500/20 flex items-center justify-center mb-3 border border-yellow-500/30">
          <AlertTriangle className="w-7 h-7 text-yellow-400" />
        </div>
        <h2 className="font-display text-xl font-bold text-foreground mb-1">
          Running Low on Scans
        </h2>
        <p className="text-sm text-muted-foreground">
          You have <span className="font-semibold text-yellow-400">{scansRemaining}</span> scan{scansRemaining !== 1 ? 's' : ''} remaining
        </p>
      </div>

      {/* Featured 10-Pack */}
      <button
        onClick={handlePurchase}
        disabled={isPurchasing}
        className={cn(
          "w-full rounded-xl border-2 border-primary bg-primary/5 p-4 text-left transition-all relative mb-4",
          "active:scale-[0.98] touch-manipulation",
          "hover:bg-primary/10",
          isPurchasing && "opacity-50 pointer-events-none"
        )}
      >
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center gap-1">
          🔥 MOST POPULAR
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center">
              <Package className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-lg">10 Scan Pack</p>
              <p className="text-xs text-muted-foreground">$0.80 per scan • Save $2</p>
            </div>
          </div>
          <span className="text-2xl font-bold text-primary">$8</span>
        </div>
      </button>

      {/* Loading indicator */}
      {isPurchasing && (
        <div className="flex items-center justify-center gap-2 mb-4 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Preparing checkout...</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button 
          variant="ghost" 
          onClick={onDismiss} 
          className="flex-1 h-11 text-muted-foreground"
          disabled={isPurchasing}
        >
          Remind me later
        </Button>
        <Button 
          variant="outline" 
          onClick={onClose} 
          className="h-11 px-3"
          disabled={isPurchasing}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export function LowScansPopup({ 
  isOpen, 
  onClose, 
  onDismiss, 
  onPurchase, 
  scansRemaining, 
  isPurchasing = false 
}: LowScansPopupProps) {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={onDismiss}>
        <DrawerContent className="px-4 pb-6 pt-4">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Running Low on Scans</DrawerTitle>
            <DrawerDescription>Purchase more scans to continue</DrawerDescription>
          </DrawerHeader>
          <PopupContent 
            onClose={onClose}
            onDismiss={onDismiss}
            onPurchase={onPurchase}
            scansRemaining={scansRemaining}
            isPurchasing={isPurchasing}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onDismiss}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="sr-only">
          <DialogTitle>Running Low on Scans</DialogTitle>
          <DialogDescription>Purchase more scans to continue</DialogDescription>
        </DialogHeader>
        <PopupContent 
          onClose={onClose}
          onDismiss={onDismiss}
          onPurchase={onPurchase}
          scansRemaining={scansRemaining}
          isPurchasing={isPurchasing}
        />
      </DialogContent>
    </Dialog>
  );
}
