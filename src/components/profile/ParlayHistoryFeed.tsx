import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ParlayHistoryCard } from './ParlayHistoryCard';
import { BotParlayCard } from '@/components/bot/BotParlayCard';
import { Loader2, History, Bot } from 'lucide-react';
import type { BotParlay } from '@/hooks/useBotEngine';

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
  const [botParlays, setBotParlays] = useState<BotParlay[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchHistory();
      fetchBotParlays();
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

  const fetchBotParlays = async () => {
    try {
      const { data, error } = await supabase
        .from('bot_daily_parlays')
        .select('*')
        .neq('outcome', 'pending')
        .neq('outcome', 'void')
        .order('settled_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      const typed = (data || []).map(p => ({
        ...p,
        legs: Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs as string),
      })) as BotParlay[];
      setBotParlays(typed);
    } catch (error) {
      console.error('Error fetching bot parlays:', error);
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

  const hasNoData = history.length === 0 && botParlays.length === 0;

  if (hasNoData) {
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
      {history.length > 0 && (
        <>
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
        </>
      )}

      {botParlays.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <Bot className="w-4 h-4 text-primary" />
            <h3 className="font-display text-lg text-foreground">BOT RESULTS</h3>
          </div>
          {botParlays.map((parlay) => (
            <BotParlayCard key={parlay.id} parlay={parlay} />
          ))}
        </>
      )}
    </div>
  );
};
