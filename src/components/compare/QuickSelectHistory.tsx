import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, History, X } from 'lucide-react';
import { DEGEN_TIERS, DegenerateLevel } from '@/types/parlay';
import { cn } from '@/lib/utils';
import { LegInput } from './ParlaySlot';

interface ParlayLeg {
  description: string;
  odds: number;
}

interface ParlayHistoryItem {
  id: string;
  legs: ParlayLeg[];
  stake: number;
  potential_payout: number;
  combined_probability: number;
  degenerate_level: string;
  created_at: string;
}

interface QuickSelectHistoryProps {
  onSelect: (legs: LegInput[], stake: string) => void;
  onClose: () => void;
}

export function QuickSelectHistory({ onSelect, onClose }: QuickSelectHistoryProps) {
  const { user } = useAuth();
  const [history, setHistory] = useState<ParlayHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchHistory();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const fetchHistory = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('parlay_history')
        .select('id, legs, stake, potential_payout, combined_probability, degenerate_level, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      
      const typedData = (data || []).map(item => ({
        ...item,
        legs: item.legs as unknown as ParlayLeg[]
      }));
      
      setHistory(typedData);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (item: ParlayHistoryItem) => {
    const legs: LegInput[] = item.legs.map(leg => ({
      id: crypto.randomUUID(),
      description: leg.description,
      odds: leg.odds.toString()
    }));
    onSelect(legs, item.stake.toString());
  };

  if (!user) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg">Select from History</h3>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-center py-8">
            <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground mb-4">Sign in to access your parlay history</p>
            <Button variant="default" onClick={onClose}>
              Got it
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl p-4 max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg">Select from History</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {history.length === 0 ? (
          <div className="text-center py-8">
            <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No saved parlays yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Save parlays from the results page to use them here
            </p>
          </div>
        ) : (
          <div className="overflow-y-auto space-y-2 flex-1">
            {history.map((item) => {
              const tier = DEGEN_TIERS[item.degenerate_level as DegenerateLevel];
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={cn(
                    "w-full text-left p-3 rounded-xl border border-border",
                    "hover:border-primary/50 hover:bg-primary/5 transition-all",
                    "active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-xs">
                      {item.legs.length} legs
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2 mb-2">
                    <span>{tier?.emoji || '🎟️'}</span>
                    <span className="text-sm font-medium truncate">
                      {item.legs[0]?.description || 'Unknown'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      ${item.stake} → ${item.potential_payout.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">
                      {(item.combined_probability * 100).toFixed(1)}%
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
