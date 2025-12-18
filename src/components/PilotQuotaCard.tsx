import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Zap, Package, Scan, Loader2, GitCompare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

interface PilotQuotaCardProps {
  freeScansRemaining: number;
  freeComparesRemaining: number;
  paidScanBalance: number;
  isPurchasing?: boolean;
  onPurchase: (packType: 'single' | 'pack20' | 'pack50') => void;
}

export function PilotQuotaCard({
  freeScansRemaining,
  freeComparesRemaining,
  paidScanBalance,
  isPurchasing = false,
  onPurchase,
}: PilotQuotaCardProps) {
  const totalFreeScans = 5;
  const totalFreeCompares = 3;
  const { lightTap } = useHapticFeedback();

  const handlePurchase = (packType: 'single' | 'pack20' | 'pack50') => {
    lightTap();
    onPurchase(packType);
  };

  const getScanProgressColor = () => {
    const percentage = (freeScansRemaining / totalFreeScans) * 100;
    if (percentage > 60) return "bg-emerald-500";
    if (percentage > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getCompareProgressColor = () => {
    const percentage = (freeComparesRemaining / totalFreeCompares) * 100;
    if (percentage > 60) return "bg-emerald-500";
    if (percentage > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <Card className="border-primary/20 overflow-hidden">
      {/* Gradient top accent */}
      <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />
      
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scan className="w-5 h-5 text-primary" />
          Your Credits
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Free Scans Progress */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <Scan className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Free Scans</span>
            </div>
            <span className="font-bold tabular-nums">{freeScansRemaining}/{totalFreeScans}</span>
          </div>
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-500", getScanProgressColor())}
              style={{ width: `${(freeScansRemaining / totalFreeScans) * 100}%` }}
            />
          </div>
        </div>

        {/* Free Compares Progress */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Free Compares</span>
            </div>
            <span className="font-bold tabular-nums">{freeComparesRemaining}/{totalFreeCompares}</span>
          </div>
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all duration-500", getCompareProgressColor())}
              style={{ width: `${(freeComparesRemaining / totalFreeCompares) * 100}%` }}
            />
          </div>
        </div>

        {/* Paid Balance */}
        {paidScanBalance > 0 && (
          <div className="flex items-center justify-between p-3 bg-primary/10 rounded-xl border border-primary/20">
            <span className="text-sm font-medium">Paid Scans</span>
            <span className="text-xl font-bold text-primary tabular-nums">{paidScanBalance}</span>
          </div>
        )}

        {/* Purchase Options */}
        <div className="pt-3 space-y-3 border-t border-border">
          <p className="text-xs text-muted-foreground text-center font-medium">Need more scans?</p>
          
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePurchase('single')}
              disabled={isPurchasing}
              className={cn(
                "flex flex-col h-auto py-3 active:scale-95 transition-all touch-manipulation",
                "hover:border-primary/50"
              )}
            >
              {isPurchasing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Zap className="w-5 h-5 mb-1 text-primary" />
                  <span className="text-xs font-medium">1 Scan</span>
                  <span className="text-sm font-bold text-primary">$1</span>
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePurchase('pack20')}
              disabled={isPurchasing}
              className={cn(
                "flex flex-col h-auto py-3 active:scale-95 transition-all touch-manipulation",
                "border-primary bg-primary/5 hover:bg-primary/10"
              )}
            >
              {isPurchasing ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : (
                <>
                  <Package className="w-5 h-5 mb-1 text-primary" />
                  <span className="text-xs font-medium">20 Pack</span>
                  <span className="text-sm font-bold text-primary">$15</span>
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePurchase('pack50')}
              disabled={isPurchasing}
              className={cn(
                "flex flex-col h-auto py-3 active:scale-95 transition-all touch-manipulation",
                "hover:border-accent/50"
              )}
            >
              {isPurchasing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Package className="w-5 h-5 mb-1 text-accent" />
                  <span className="text-xs font-medium">50 Pack</span>
                  <span className="text-sm font-bold text-accent">$40</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
