import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ParlayHistoryCard } from './ParlayHistoryCard';
import { Loader2, History } from 'lucide-react';

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
  is_won: boolean | null;
  is_settled: boolean;
  ai_roasts: string[] | null;
  created_at: string;
  event_start_time: string | null;
}

interface ParlayHistoryFeedProps {
  onStatsUpdate: () => void;
}

export const ParlayHistoryFeed = ({ onStatsUpdate }: ParlayHistoryFeedProps) => {
  const { user } = useAuth();
  const [history, setHistory] = useState<ParlayHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user]);

  const fetchHistory = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('parlay_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Type cast the data properly
      const typedData = (data || []).map(item => ({
        ...item,
        legs: item.legs as unknown as ParlayLeg[],
        ai_roasts: item.ai_roasts as unknown as string[] | null
      }));
      
      setHistory(typedData);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSettle = (id: string, isWon: boolean) => {
    setHistory(prev => prev.map(item => 
      item.id === id ? { ...item, is_won: isWon, is_settled: true } : item
    ));
    onStatsUpdate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-8">
        <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No parlays saved yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a slip and save it to start tracking!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-display text-lg text-foreground">PARLAY HISTORY</h3>
      {history.map((item) => (
        <ParlayHistoryCard
          key={item.id}
          id={item.id}
          legs={item.legs}
          stake={item.stake}
          potentialPayout={item.potential_payout}
          combinedProbability={item.combined_probability}
          degenerateLevel={item.degenerate_level}
          isWon={item.is_won}
          isSettled={item.is_settled}
          aiRoasts={item.ai_roasts}
          createdAt={item.created_at}
          eventStartTime={item.event_start_time}
          onSettle={handleSettle}
        />
      ))}
    </div>
  );
};
