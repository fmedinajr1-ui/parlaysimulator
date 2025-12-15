import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { BankrollManager } from '@/components/bankroll/BankrollManager';
import { KellyStakeCard } from '@/components/results/KellyStakeCard';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Calculator, 
  Wallet, 
  TrendingUp, 
  AlertTriangle,
  Info
} from 'lucide-react';
import { useBankroll } from '@/hooks/useBankroll';
import { analyzeTilt } from '@/lib/kelly-calculator';

const Kelly = () => {
  const { settings, getDrawdownPercent } = useBankroll();
  const [manualOdds, setManualOdds] = useState<string>('');
  const [manualProbability, setManualProbability] = useState<string>('');
  const [manualStake, setManualStake] = useState<string>('');

  const parsedOdds = parseFloat(manualOdds) || 0;
  const parsedProbability = (parseFloat(manualProbability) || 0) / 100;
  const parsedStake = parseFloat(manualStake) || 0;

  const hasValidInputs = parsedOdds !== 0 && parsedProbability > 0 && parsedProbability < 1;

  // Tilt analysis
  const tiltAnalysis = settings ? analyzeTilt(
    settings.currentWinStreak || 0,
    settings.currentLossStreak || 0,
    parsedStake || (settings.bankrollAmount * settings.defaultUnitSize),
    settings.bankrollAmount,
    settings.peakBankroll
  ) : null;

  return (
    <AppShell noPadding>
      <MobileHeader 
        title="Money Management"
        icon={<Wallet className="w-5 h-5" />}
      />

      <div className="px-4 py-4 space-y-4">
        {/* Bankroll Manager */}
        <BankrollManager />

        {/* Tilt Warning */}
        {tiltAnalysis?.isTilting && (
          <FeedCard variant="highlight" className="border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-500">Tilt Warning</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {tiltAnalysis.tiltReason}
                </p>
                <p className="text-sm font-medium mt-2">
                  {tiltAnalysis.suggestedAction}
                </p>
              </div>
            </div>
          </FeedCard>
        )}

        {/* Manual Kelly Calculator */}
        <FeedCard>
          <div className="flex items-center gap-2 mb-4">
            <Calculator className="w-5 h-5 text-primary" />
            <h3 className="font-display text-lg">Quick Kelly Calculator</h3>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="odds">American Odds</Label>
                <Input
                  id="odds"
                  type="text"
                  placeholder="+150 or -110"
                  value={manualOdds}
                  onChange={(e) => setManualOdds(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="probability">Win Probability %</Label>
                <Input
                  id="probability"
                  type="number"
                  placeholder="55"
                  min={1}
                  max={99}
                  value={manualProbability}
                  onChange={(e) => setManualProbability(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stake">Your Stake (optional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="stake"
                  type="number"
                  placeholder="Enter to compare"
                  className="pl-8"
                  value={manualStake}
                  onChange={(e) => setManualStake(e.target.value)}
                />
              </div>
            </div>

            {!hasValidInputs && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Info className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Enter odds and win probability to calculate optimal stake
                </p>
              </div>
            )}
          </div>
        </FeedCard>

        {/* Kelly Result */}
        {hasValidInputs && (
          <KellyStakeCard
            winProbability={parsedProbability}
            americanOdds={parsedOdds}
            userStake={parsedStake > 0 ? parsedStake : undefined}
          />
        )}

        {/* Quick Tips */}
        <FeedCard className="bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-neon-green" />
            <h3 className="font-display text-lg">Kelly Tips</h3>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">1</Badge>
              <p>Use <strong>Half Kelly</strong> (50%) for most bets - it reduces variance while maintaining 75% of expected growth.</p>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">2</Badge>
              <p>Never bet more than <strong>5%</strong> of your bankroll on a single bet, even if Kelly suggests higher.</p>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">3</Badge>
              <p>If Kelly suggests <strong>no bet</strong>, there's no edge - pass on the bet.</p>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0">4</Badge>
              <p>After a <strong>3+ loss streak</strong>, consider reducing stakes by 50% to protect your bankroll.</p>
            </div>
          </div>
        </FeedCard>
      </div>
    </AppShell>
  );
};

export default Kelly;
