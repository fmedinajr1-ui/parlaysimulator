import React, { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { RiskModeProvider } from '@/contexts/RiskModeContext';
import { CustomerScoutView } from '@/components/scout/CustomerScoutView';
import { WarRoomGameStrip, type PropsGame } from '@/components/scout/warroom/WarRoomGameStrip';
import { useDeepSweetSpots } from '@/hooks/useDeepSweetSpots';
import { useSweetSpotLiveData } from '@/hooks/useSweetSpotLiveData';
import { ArrowLeft, Gamepad2 } from 'lucide-react';
import type { ScoutGameContext } from '@/pages/Scout';

export function AdminWarRoomView() {
  const [gameContext, setGameContext] = useState<ScoutGameContext | null>(null);
  const latestResolveRef = useRef<string>('');

  // Fetch sweet spots to build game list for picker
  const { data: sweetSpotData } = useDeepSweetSpots();
  const rawSpots = sweetSpotData?.spots ?? [];
  const { spots: allEnrichedSpots } = useSweetSpotLiveData(rawSpots);

  // Build available games from props data
  const availableGames: PropsGame[] = useMemo(() => {
    const gameMap = new Map<string, PropsGame>();
    for (const s of allEnrichedSpots) {
      const desc = s.gameDescription;
      if (!desc) continue;
      if (gameMap.has(desc)) {
        gameMap.get(desc)!.propCount++;
        continue;
      }
      const parts = desc.split(/\s+@\s+/);
      if (parts.length < 2) continue;
      gameMap.set(desc, {
        awayTeam: parts[0].trim(),
        homeTeam: parts[1].trim(),
        gameDescription: desc,
        commenceTime: s.gameTime || '',
        propCount: 1,
      });
    }
    return Array.from(gameMap.values()).filter(g => g.homeTeam && g.awayTeam);
  }, [allEnrichedSpots]);

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

  const handleGameChange = useCallback((game: { eventId: string; homeTeam: string; awayTeam: string; gameDescription: string }) => {
    resolveAndSetGame(game.eventId, game.homeTeam, game.awayTeam, '', game.gameDescription);
  }, [resolveAndSetGame]);

  // No game selected — show picker
  if (!gameContext) {
    return (
      <RiskModeProvider>
        <div className="warroom min-h-[60vh] flex flex-col items-center justify-center gap-6 p-4">
          <div className="flex flex-col items-center gap-2">
            <Gamepad2 className="w-8 h-8 text-[hsl(var(--warroom-green))]" />
            <h2 className="text-lg font-semibold">Select a Game</h2>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Choose a game below to load the War Room with live prop intelligence.
            </p>
          </div>
          {availableGames.length > 0 ? (
            <div className="w-full max-w-2xl">
              <WarRoomGameStrip
                propsGames={availableGames}
                onSelectGame={handleGameChange}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No games with props available right now.</p>
          )}
        </div>
      </RiskModeProvider>
    );
  }

  return (
    <RiskModeProvider>
      <div className="space-y-1">
        <button
          onClick={() => setGameContext(null)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5"
        >
          <ArrowLeft className="w-3 h-3" />
          Change Game
        </button>
        <CustomerScoutView
          gameContext={gameContext}
          isDemo={false}
          onGameChange={handleGameChange}
        />
      </div>
    </RiskModeProvider>
  );
}
