import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { ParlayVsSharpComparison } from '@/components/compare/ParlayVsSharpComparison';
import { Button } from '@/components/ui/button';
import { UniversalLeg } from '@/types/universal-parlay';
import { Shield, ArrowLeft } from 'lucide-react';

const SharpComparison = () => {
  const navigate = useNavigate();
  const [legs, setLegs] = useState<UniversalLeg[]>([]);

  useEffect(() => {
    // Load parlay from session storage
    const stored = sessionStorage.getItem('sharp-compare-parlay');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setLegs(parsed);
      } catch (e) {
        console.error('Failed to parse parlay data:', e);
      }
    }
  }, []);

  return (
    <AppShell className="pt-safe pb-6">
      <MobileHeader
        title="Sharp Comparison"
        subtitle="Your picks vs the pros"
        icon={<Shield className="h-5 w-5 text-primary" />}
        showBack
        rightAction={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/sharp')}
            className="text-xs"
          >
            Sharp Dashboard
          </Button>
        }
      />

      <div className="px-4 py-4 space-y-4">
        {legs.length > 0 ? (
          <ParlayVsSharpComparison legs={legs} />
        ) : (
          <div className="text-center py-12">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Parlay to Compare</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Build a parlay first, then use "vs Sharps" to compare your picks against professional bettors.
            </p>
            <Button onClick={() => navigate('/upload')}>
              Build a Parlay
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default SharpComparison;
