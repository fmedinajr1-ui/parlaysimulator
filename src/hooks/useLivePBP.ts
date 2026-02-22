import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PBPPlayer {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  plusMinus: number;
}

export interface PBPPlay {
  time: string;
  text: string;
  playType: string;
  team?: string;
  playerName?: string;
  isHighMomentum?: boolean;
}

export interface PBPData {
  players: PBPPlayer[];
  recentPlays: PBPPlay[];
  period?: number;
  clock?: string;
  homeScore?: number;
  awayScore?: number;
  pace?: number;
  notAvailable?: boolean;
}

export function useLivePBP(espnEventId: string | undefined, gameStatus: string | undefined) {
  const [data, setData] = useState<PBPData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Clear stale data immediately when espnEventId changes
  useEffect(() => {
    setData(null);
  }, [espnEventId]);

  const shouldPoll = espnEventId && (gameStatus === 'in_progress' || gameStatus === 'halftime');

  const fetchPBP = useCallback(async () => {
    if (!espnEventId) return;
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('fetch-live-pbp', {
        body: { eventId: espnEventId },
      });
      if (error) {
        console.error('[useLivePBP] Error:', error);
        return;
      }
      if (result && !result.notAvailable) {
        setData(result as PBPData);
      }
    } catch (err) {
      console.error('[useLivePBP] Fetch failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [espnEventId]);

  useEffect(() => {
    if (!shouldPoll) return;
    fetchPBP();
    const interval = setInterval(fetchPBP, 8000);
    return () => clearInterval(interval);
  }, [shouldPoll, fetchPBP]);

  return { data, isLoading };
}
