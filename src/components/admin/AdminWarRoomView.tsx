import React, { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RiskModeProvider } from '@/contexts/RiskModeContext';
import { CustomerScoutView } from '@/components/scout/CustomerScoutView';
import { demoGameContext } from '@/data/demoScoutData';
import type { ScoutGameContext } from '@/pages/Scout';

export function AdminWarRoomView() {
  const [gameContext, setGameContext] = useState<ScoutGameContext | null>(null);
  const latestResolveRef = useRef<string>('');

  // Fetch admin-set active game
  const { data: activeGame } = useQuery({
    queryKey: ['scout-active-game'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scout_active_game')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  // Resolve ESPN ID and build game context
  const resolveAndSetGame = useCallback((eventId: string, homeTeam: string, awayTeam: string, commenceTime: string, gameDescription: string) => {
    latestResolveRef.current = eventId;
    const game: ScoutGameContext = {
      eventId, homeTeam, awayTeam, commenceTime, gameDescription,
      homeRoster: [], awayRoster: [],
    };
    setGameContext(game);

    supabase.functions.invoke('get-espn-event-id', {
      body: { homeTeam, awayTeam },
    }).then(({ data }) => {
      if (data?.espnEventId && latestResolveRef.current === eventId) {
        setGameContext(prev => prev?.eventId === eventId ? { ...prev, espnEventId: data.espnEventId } : prev);
      }
    }).catch(err => console.error('ESPN ID resolve failed:', err));
  }, []);

  // Auto-resolve when active game loads
  React.useEffect(() => {
    if (activeGame && !gameContext) {
      resolveAndSetGame(
        activeGame.event_id,
        activeGame.home_team,
        activeGame.away_team,
        activeGame.commence_time ?? '',
        activeGame.game_description ?? `${activeGame.away_team} @ ${activeGame.home_team}`
      );
    }
  }, [activeGame, gameContext, resolveAndSetGame]);

  const handleGameChange = useCallback((game: { eventId: string; homeTeam: string; awayTeam: string; gameDescription: string }) => {
    resolveAndSetGame(game.eventId, game.homeTeam, game.awayTeam, '', game.gameDescription);
  }, [resolveAndSetGame]);

  const isDemo = !activeGame && !gameContext;
  const ctx = gameContext || demoGameContext;

  return (
    <RiskModeProvider>
      <CustomerScoutView
        gameContext={ctx}
        isDemo={isDemo}
        adminEventId={activeGame?.event_id}
        onGameChange={handleGameChange}
      />
    </RiskModeProvider>
  );
}
