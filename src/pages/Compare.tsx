import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ParlaySlot, LegInput } from '@/components/compare/ParlaySlot';
import { ComparisonDashboard } from '@/components/compare/ComparisonDashboard';
import { QuickSelectHistory } from '@/components/compare/QuickSelectHistory';
import { TutorialOverlay } from '@/components/tutorial/TutorialOverlay';
import { PilotPaywallModal } from '@/components/PilotPaywallModal';
import { PaywallModal } from '@/components/PaywallModal';
import { compareTutorialSteps } from '@/components/tutorial/tutorialSteps';
import { compareParlays, ComparisonResult } from '@/lib/comparison-utils';
import { createLeg, simulateParlay, americanToDecimal } from '@/lib/parlay-calculator';
import { ParlayLeg, ParlaySimulation } from '@/types/parlay';
import { toast } from '@/hooks/use-toast';
import { useTutorial } from '@/hooks/useTutorial';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { usePilotUser } from '@/hooks/usePilotUser';
import { Plus, Scale, Loader2, RotateCcw, HelpCircle, Home, Crown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SlotState {
  id: string;
  legs: LegInput[];
  stake: string;
  extractedTotalOdds: number | null;
  status: 'empty' | 'filled' | 'processing';
}

// Calculate estimated per-leg odds when we only have total odds
function calculateEstimatedLegOdds(totalOdds: number, numLegs: number): number {
  const totalDecimal = americanToDecimal(totalOdds);
  const perLegDecimal = Math.pow(totalDecimal, 1 / numLegs);
  
  if (perLegDecimal >= 2) {
    return Math.round((perLegDecimal - 1) * 100);
  } else {
    return Math.round(-100 / (perLegDecimal - 1));
  }
}

const createEmptySlot = (): SlotState => ({
  id: crypto.randomUUID(),
  legs: [],
  stake: '10',
  extractedTotalOdds: null,
  status: 'empty'
});

const Compare = () => {
  const { user } = useAuth();
  const { isSubscribed, isAdmin, startCheckout } = useSubscription();
  const { isPilotUser, freeComparesRemaining, decrementScan, purchaseScans } = usePilotUser();
  
  const [slots, setSlots] = useState<SlotState[]>([createEmptySlot(), createEmptySlot()]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [historySlotIndex, setHistorySlotIndex] = useState<number | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showPilotPaywall, setShowPilotPaywall] = useState(false);
  
  const { showTutorial, setShowTutorial, markComplete } = useTutorial('compare');

  const updateSlot = useCallback((index: number, legs: LegInput[], stake: string, extractedTotalOdds: number | null) => {
    setSlots(prev => prev.map((slot, i) => 
      i === index 
        ? { ...slot, legs, stake, extractedTotalOdds, status: legs.length > 0 ? 'filled' : 'empty' }
        : slot
    ));
    setComparisonResult(null); // Clear previous results
  }, []);

  const clearSlot = useCallback((index: number) => {
    setSlots(prev => prev.map((slot, i) => 
      i === index ? createEmptySlot() : slot
    ));
    setComparisonResult(null);
  }, []);

  const addSlot = useCallback(() => {
    if (slots.length >= 4) {
      toast({
        title: "Max 4 parlays! 🎰",
        description: "You can compare up to 4 parlays at once.",
      });
      return;
    }
    setSlots(prev => [...prev, createEmptySlot()]);
  }, [slots.length]);

  const removeSlot = useCallback((index: number) => {
    if (slots.length <= 2) {
      toast({
        title: "Need at least 2 parlays!",
        description: "You need at least 2 parlays to compare.",
      });
      return;
    }
    setSlots(prev => prev.filter((_, i) => i !== index));
    setComparisonResult(null);
  }, [slots.length]);

  const handleSelectFromHistory = useCallback((index: number) => {
    setHistorySlotIndex(index);
  }, []);

  const handleHistorySelect = useCallback((legs: LegInput[], stake: string) => {
    if (historySlotIndex !== null) {
      updateSlot(historySlotIndex, legs, stake, null);
    }
    setHistorySlotIndex(null);
  }, [historySlotIndex, updateSlot]);

  const validateAndSimulate = (slot: SlotState): ParlaySimulation | null => {
    if (slot.status !== 'filled' || slot.legs.length < 2) {
      return null;
    }

    const validLegs: ParlayLeg[] = [];
    
    for (const leg of slot.legs) {
      if (!leg.description.trim()) {
        return null;
      }
      
      if (slot.extractedTotalOdds !== null) {
        const oddsNum = leg.odds ? parseInt(leg.odds) : calculateEstimatedLegOdds(slot.extractedTotalOdds, slot.legs.length);
        if (leg.odds && (isNaN(oddsNum) || oddsNum === 0 || (oddsNum > -100 && oddsNum < 100))) {
          return null;
        }
        validLegs.push(createLeg(leg.description, oddsNum));
      } else {
        const oddsNum = parseInt(leg.odds);
        if (isNaN(oddsNum) || oddsNum === 0 || (oddsNum > -100 && oddsNum < 100)) {
          return null;
        }
        validLegs.push(createLeg(leg.description, oddsNum));
      }
    }

    const stakeNum = parseFloat(slot.stake);
    if (isNaN(stakeNum) || stakeNum <= 0) {
      return null;
    }

    return simulateParlay(validLegs, stakeNum, slot.extractedTotalOdds ?? undefined);
  };

  const handleCompare = useCallback(async () => {
    const filledSlots = slots.filter(s => s.status === 'filled');
    
    if (filledSlots.length < 2) {
      toast({
        title: "Need more parlays! 🎯",
        description: "Fill in at least 2 parlays to compare.",
        variant: "destructive",
      });
      return;
    }

    // Check quota for pilot users
    if (user && !isSubscribed && !isAdmin && isPilotUser) {
      if (freeComparesRemaining <= 0) {
        setShowPilotPaywall(true);
        return;
      }
    }

    setIsComparing(true);

    try {
      const simulations: ParlaySimulation[] = [];
      
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.status === 'filled') {
          const sim = validateAndSimulate(slot);
          if (!sim) {
            toast({
              title: `Invalid Parlay ${i + 1} ❌`,
              description: "Check all legs have descriptions and valid odds.",
              variant: "destructive",
            });
            setIsComparing(false);
            return;
          }
          simulations.push(sim);
        }
      }

      const result = compareParlays(simulations);
      setComparisonResult(result);

      // Decrement compare quota for pilot users
      if (user && !isSubscribed && !isAdmin && isPilotUser) {
        await decrementScan('compare');
      }

      toast({
        title: "Comparison complete! 📊",
        description: `Analyzed ${simulations.length} parlays. Check out the results!`,
      });
    } catch (error) {
      console.error('Comparison error:', error);
      toast({
        title: "Comparison failed 😵",
        description: "Something went wrong. Try again.",
        variant: "destructive",
      });
    } finally {
      setIsComparing(false);
    }
  }, [slots, user, isSubscribed, isAdmin, isPilotUser, freeComparesRemaining, decrementScan]);

  const handleReset = useCallback(() => {
    setSlots([createEmptySlot(), createEmptySlot()]);
    setComparisonResult(null);
  }, []);

  const filledCount = slots.filter(s => s.status === 'filled').length;

  return (
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe">
      {/* Tutorial Overlay */}
      <TutorialOverlay
        steps={compareTutorialSteps}
        isOpen={showTutorial}
        onComplete={markComplete}
        onSkip={markComplete}
      />
      
      <main className="max-w-lg mx-auto px-3 py-3">
        {/* Header - compact for mobile */}
        <div className="text-center mb-4 header-compact">
          <div className="flex items-center justify-center gap-2">
            <Link 
              to="/" 
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Go home"
            >
              <Home className="w-5 h-5" />
            </Link>
            <h1 className="font-display text-2xl sm:text-3xl text-gradient-fire">
              ⚖️ COMPARE PARLAYS
            </h1>
            <button
              onClick={() => setShowTutorial(true)}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Show tutorial"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
          </div>
          <p className="text-muted-foreground text-sm">
            Add up to 4 parlays and find your best bet.
          </p>

          {/* Quota Indicator */}
          {user && (
            <div className="flex justify-center items-center gap-2 mt-2">
              {isSubscribed || isAdmin ? (
                <Badge className="bg-primary/20 text-primary border-primary/30 gap-1">
                  <Crown className="w-3 h-3" />
                  {isAdmin ? 'ADMIN' : 'PRO'} - Unlimited
                </Badge>
              ) : isPilotUser ? (
                <Badge 
                  variant="outline" 
                  className={cn(
                    "gap-1",
                    freeComparesRemaining === 0 && "border-destructive/50 text-destructive"
                  )}
                >
                  {freeComparesRemaining} Compares Left
                </Badge>
              ) : null}
            </div>
          )}
        </div>

        {/* Parlay Slots - scrollable area */}
        <div className="space-y-3 mb-4 scroll-area-mobile scrollbar-hide">
          {slots.map((slot, index) => (
            <div key={slot.id} data-tutorial={`parlay-slot-${index}`}>
              <ParlaySlot
                index={index}
                legs={slot.legs}
                stake={slot.stake}
                extractedTotalOdds={slot.extractedTotalOdds}
                status={slot.status}
                onUpdate={(legs, stake, odds) => updateSlot(index, legs, stake, odds)}
                onClear={() => clearSlot(index)}
                onSelectFromHistory={() => handleSelectFromHistory(index)}
                canRemove={slots.length > 2}
                showTutorialAttributes={index === 0}
              />
            </div>
          ))}
        </div>

        {/* Add Slot Button */}
        {slots.length < 4 && (
          <Button
            variant="outline"
            className="w-full mb-4 border-dashed h-11 touch-target"
            onClick={addSlot}
            data-tutorial="add-slot"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Another Parlay
          </Button>
        )}

        {/* Action Buttons - sticky on mobile */}
        <div className="sticky-bottom-actions">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleReset}
              className="flex-1 h-12 touch-target-lg"
              disabled={isComparing}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button
              onClick={handleCompare}
              className="flex-[2] h-12 gradient-fire touch-target-lg"
              disabled={isComparing || filledCount < 2}
              data-tutorial="compare-button"
            >
              {isComparing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Comparing...
                </>
              ) : (
                <>
                  <Scale className="w-4 h-4 mr-2" />
                  Compare ({filledCount}/4)
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Comparison Results */}
        {comparisonResult && (
          <div className="slide-up mt-4">
            <ComparisonDashboard comparisonResult={comparisonResult} />
          </div>
        )}
      </main>

      {/* History Modal */}
      {historySlotIndex !== null && (
        <QuickSelectHistory
          onSelect={handleHistorySelect}
          onClose={() => setHistorySlotIndex(null)}
        />
      )}

      {/* Paywall Modals */}
      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={startCheckout}
        scansUsed={3}
      />

      <PilotPaywallModal
        isOpen={showPilotPaywall}
        onClose={() => setShowPilotPaywall(false)}
        onPurchase={purchaseScans}
        freeScansUsed={5}
      />
    </div>
  );
};

export default Compare;
