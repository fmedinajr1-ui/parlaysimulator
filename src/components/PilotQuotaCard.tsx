import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Zap, Package, Scan, Loader2 } from 'lucide-react';

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

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scan className="w-5 h-5 text-primary" />
          Scan Credits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Free Scans Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Free Scans</span>
            <span className="font-medium">{freeScansRemaining}/{totalFreeScans}</span>
          </div>
          <Progress value={(freeScansRemaining / totalFreeScans) * 100} className="h-2" />
        </div>

        {/* Free Compares Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Free Compares</span>
            <span className="font-medium">{freeComparesRemaining}/{totalFreeCompares}</span>
          </div>
          <Progress value={(freeComparesRemaining / totalFreeCompares) * 100} className="h-2" />
        </div>

        {/* Paid Balance */}
        {paidScanBalance > 0 && (
          <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
            <span className="text-sm font-medium">Paid Scans Balance</span>
            <span className="text-lg font-bold text-primary">{paidScanBalance}</span>
          </div>
        )}

        {/* Purchase Options */}
        <div className="pt-2 space-y-2">
          <p className="text-xs text-muted-foreground text-center">Need more scans?</p>
          
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPurchase('single')}
              disabled={isPurchasing}
              className="flex flex-col h-auto py-2"
            >
              {isPurchasing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Zap className="w-4 h-4 mb-1" />
                  <span className="text-xs">1 Scan</span>
                  <span className="text-xs font-bold">$1</span>
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPurchase('pack20')}
              disabled={isPurchasing}
              className="flex flex-col h-auto py-2 border-primary"
            >
              {isPurchasing ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              ) : (
                <>
                  <Package className="w-4 h-4 mb-1 text-primary" />
                  <span className="text-xs">20 Pack</span>
                  <span className="text-xs font-bold text-primary">$15</span>
                </>
              )}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPurchase('pack50')}
              disabled={isPurchasing}
              className="flex flex-col h-auto py-2"
            >
              {isPurchasing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Package className="w-4 h-4 mb-1" />
                  <span className="text-xs">50 Pack</span>
                  <span className="text-xs font-bold">$40</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
