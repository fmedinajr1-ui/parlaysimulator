import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Check, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { DEGEN_TIERS, DegenerateLevel } from '@/types/parlay';

interface ParlayLeg {
  description: string;
  odds: number;
}

interface ParlayHistoryCardProps {
  id: string;
  legs: ParlayLeg[];
  stake: number;
  potentialPayout: number;
  combinedProbability: number;
  degenerateLevel: string;
  isWon: boolean | null;
  isSettled: boolean;
  aiRoasts: string[] | null;
  createdAt: string;
  onSettle: (id: string, isWon: boolean) => void;
}

export const ParlayHistoryCard = ({
  id,
  legs,
  stake,
  potentialPayout,
  combinedProbability,
  degenerateLevel,
  isWon,
  isSettled,
  aiRoasts,
  createdAt,
  onSettle
}: ParlayHistoryCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSettling, setIsSettling] = useState(false);

  const tier = DEGEN_TIERS[degenerateLevel as DegenerateLevel] || DEGEN_TIERS.SWEAT_SEASON;

  const handleSettle = async (won: boolean) => {
    setIsSettling(true);
    try {
      const { error } = await supabase
        .from('parlay_history')
        .update({
          is_won: won,
          is_settled: true,
          settled_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;

      // Update profile stats
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const updateField = won ? 'total_wins' : 'total_losses';
        const payoutUpdate = won ? { total_payout: potentialPayout } : {};
        
        // Get current profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('total_wins, total_losses, total_payout')
          .eq('user_id', user.id)
          .single();

        if (profile) {
          await supabase
            .from('profiles')
            .update({
              [updateField]: (profile[updateField as keyof typeof profile] as number) + 1,
              ...(won ? { total_payout: (profile.total_payout as number) + potentialPayout } : {})
            })
            .eq('user_id', user.id);
        }
      }

      onSettle(id, won);
      toast({
        title: won ? "W! 🔥" : "L... 💀",
        description: won ? "Nice hit, degen!" : "The books thank you for your donation."
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSettling(false);
    }
  };

  return (
    <FeedCard className={isSettled ? (isWon ? 'border-l-4 border-l-neon-green' : 'border-l-4 border-l-neon-red') : ''}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{tier.emoji}</span>
          <div>
            <p className="font-semibold text-foreground">{legs.length}-Leg Parlay</p>
            <p className="text-xs text-muted-foreground">
              {format(new Date(createdAt), 'MMM d, yyyy')}
            </p>
          </div>
        </div>
        <div className="text-right">
          {isSettled ? (
            <span className={`font-display text-lg ${isWon ? 'text-neon-green' : 'text-neon-red'}`}>
              {isWon ? `+$${potentialPayout.toFixed(0)}` : `-$${stake.toFixed(0)}`}
            </span>
          ) : (
            <span className="font-display text-lg text-foreground">
              ${stake.toFixed(0)} → ${potentialPayout.toFixed(0)}
            </span>
          )}
        </div>
      </div>

      {/* Probability */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">Win Probability</span>
          <span className="text-foreground">{(combinedProbability * 100).toFixed(1)}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary rounded-full"
            style={{ width: `${combinedProbability * 100}%` }}
          />
        </div>
      </div>

      {/* Settle buttons (if not settled) */}
      {!isSettled && (
        <div className="flex gap-2 mb-3">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 border-neon-red text-neon-red hover:bg-neon-red/10"
            onClick={() => handleSettle(false)}
            disabled={isSettling}
          >
            {isSettling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4 mr-1" />}
            Lost
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-neon-green hover:bg-neon-green/80 text-background"
            onClick={() => handleSettle(true)}
            disabled={isSettling}
          >
            {isSettling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
            Won
          </Button>
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-full justify-center"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="w-4 h-4" />
            Hide details
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4" />
            Show details
          </>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">LEGS</p>
          <div className="space-y-2">
            {legs.map((leg, index) => (
              <div key={index} className="flex justify-between text-sm">
                <span className="text-foreground">{leg.description}</span>
                <span className="text-muted-foreground">
                  {leg.odds > 0 ? `+${leg.odds}` : leg.odds}
                </span>
              </div>
            ))}
          </div>

          {aiRoasts && aiRoasts.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">AI ROAST</p>
              <p className="text-sm text-foreground italic">"{aiRoasts[0]}"</p>
            </div>
          )}
        </div>
      )}
    </FeedCard>
  );
};
