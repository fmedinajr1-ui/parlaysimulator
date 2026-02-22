import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDeepSweetSpots } from '@/hooks/useDeepSweetSpots';
import { useSweetSpotLiveData } from '@/hooks/useSweetSpotLiveData';
import { useFatigueData, getFatigueByTeam } from '@/hooks/useFatigueData';
import { useRegressionDetection } from '@/hooks/useRegressionDetection';
import { useUnifiedLiveFeed } from '@/hooks/useUnifiedLiveFeed';
import { useCustomerWhaleSignals } from '@/hooks/useCustomerWhaleSignals';
import { useLivePBP } from '@/hooks/useLivePBP';
import { useMonteCarloWorker } from '@/hooks/useMonteCarloWorker';
import { CustomerLiveGamePanel } from '../CustomerLiveGamePanel';
import { supabase } from '@/integrations/supabase/client';
import { useMinutesStability } from '@/hooks/useMinutesStability';

import { CustomerConfidenceDashboard } from '../CustomerConfidenceDashboard';
import { CustomerAIWhisper } from '../CustomerAIWhisper';
import { WarRoomPropCard, type WarRoomPropData } from './WarRoomPropCard';
import { HedgeModeTable } from './HedgeModeTable';
import { HedgeSlideIn, type HedgeOpportunity } from './HedgeSlideIn';
import { AdvancedMetricsPanel } from './AdvancedMetricsPanel';
import { WarRoomGameStrip, type PropsGame } from './WarRoomGameStrip';
import { demoConfidencePicks, demoWhisperPicks, demoWhaleSignals } from '@/data/demoScoutData';
import type { ScoutGameContext } from '@/pages/Scout';

interface WarRoomLayoutProps {
  gameContext: ScoutGameContext;
  isDemo?: boolean;
  adminEventId?: string;
  onGameChange?: (game: { eventId: string; homeTeam: string; awayTeam: string; gameDescription: string }) => void;
}

type ViewMode = 'game' | 'hedge';

// Convert American odds to implied probability
function americanToImplied(odds: number): number {
  if (odds >= 100) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

export function WarRoomLayout({ gameContext, isDemo = false, adminEventId, onGameChange }: WarRoomLayoutProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('game');
  const [useMonteCarloMode, setUseMonteCarloMode] = useState(false);
  const [mcResults, setMcResults] = useState<Map<string, number>>(new Map());
  const { homeTeam, awayTeam } = gameContext;

  // Data hooks
  const { data: sweetSpotData } = useDeepSweetSpots();
  const rawSpots = sweetSpotData?.spots ?? [];
  const { spots: allEnrichedSpots } = useSweetSpotLiveData(rawSpots);

  // Live PBP for pace data
  const { data: pbpData } = useLivePBP(gameContext.espnEventId, undefined);
  const paceMult = (pbpData?.pace ?? 100) / 100;

  // MC worker
  const { runSimulation } = useMonteCarloWorker();

  // Trigger sync-live-scores once on mount
  useEffect(() => {
    supabase.functions.invoke('sync-live-scores', { body: { sport: 'NBA' } })
      .catch(err => console.error('sync-live-scores error:', err));
  }, []);

  // Build available games list from props data
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

  // Filter spots to only the selected game's teams
  const enrichedSpots = useMemo(() => {
    if (!homeTeam || !awayTeam) return allEnrichedSpots;
    return allEnrichedSpots.filter((s) => {
      const desc = s.gameDescription ?? '';
      return desc.includes(homeTeam) && desc.includes(awayTeam);
    });
  }, [allEnrichedSpots, homeTeam, awayTeam]);

  const { data: fatigueData } = useFatigueData();
  const { alerts: regressionAlerts, getPlayerRegression } = useRegressionDetection();
  const { games } = useUnifiedLiveFeed({ enabled: true });
  const { data: whaleSignals } = useCustomerWhaleSignals();

  // Minutes stability for all players in current game
  const playerNames = useMemo(() => enrichedSpots.map(s => s.playerName), [enrichedSpots]);
  const { getStability } = useMinutesStability(playerNames);

  // Build confidence picks for dashboard (from filtered enrichedSpots)
  const liveConfidencePicks = enrichedSpots
    .map((s) => ({
      playerName: s.playerName,
      propType: s.propType,
      line: s.line,
      currentValue: s.liveData?.currentValue ?? s.l10Stats.avg,
      side: s.side,
    }));

  const liveWhisperPicks = liveConfidencePicks.map((p) => ({
    ...p,
    gameProgress: 0.5,
  }));

  const confidencePicks = isDemo ? demoConfidencePicks : liveConfidencePicks;
  const whisperPicks = isDemo ? demoWhisperPicks : liveWhisperPicks;
  const effectiveSignals = isDemo ? demoWhaleSignals : whaleSignals;

  // Build WarRoomPropData from enriched spots with live pace + odds
  const propCards: WarRoomPropData[] = useMemo(() => {
    return enrichedSpots
      .map((s) => {
        const teamFatigue = getFatigueByTeam(fatigueData, homeTeam);
        const baseFatigue = teamFatigue?.fatigue_score ?? 30;
        const minutesFactor = (s.liveData?.minutesPlayed ?? 0) / 36;
        const fatiguePercent = Math.min(100, baseFatigue + minutesFactor * 40);

        // Odds-based edge score
        const overPrice = s.overPrice ?? -110;
        const underPrice = s.underPrice ?? -110;
        const impliedOver = americanToImplied(overPrice);
        const impliedUnder = americanToImplied(underPrice);

        // Use hit rate as pre-game pOver proxy, MC results when available
        const mcPOver = mcResults.get(s.id);
        const hitRate = s.hitRateL10 ?? 0.5;
        const pOver = mcPOver ?? (s.liveData?.confidence ? s.liveData.confidence / 100 : hitRate);
        const pUnder = 1 - pOver;
        const edgeScore = s.side === 'over'
          ? (pOver - impliedOver) * 100
          : (pUnder - impliedUnder) * 100;

        // Get allBookLines from live data if available
        const spotLiveData = s.liveData as any;
        const allBookLines = spotLiveData?.allBookLines ?? undefined;

        return {
          id: s.id,
          playerName: s.playerName,
          propType: s.propType,
          line: s.line,
          side: (s.side || 'OVER').toUpperCase(),
          currentValue: s.liveData?.currentValue ?? s.l10Stats.avg,
          projectedFinal: s.liveData?.projectedFinal ?? (s.edge + s.line),
          confidence: s.liveData?.confidence ?? s.sweetSpotScore ?? 50,
          paceRating: s.liveData?.paceRating ?? Math.round((pbpData?.pace ?? 100)),
          fatiguePercent,
          regression: getPlayerRegression(s.playerName, s.propType),
          hasHedgeOpportunity: s.liveData?.hedgeStatus === 'alert' || s.liveData?.hedgeStatus === 'urgent' || false,
          hitRateL10: s.hitRateL10 ?? 0,
          liveBookLine: s.liveData?.liveBookLine ?? s.line,
          allBookLines,
          pOver,
          pUnder,
          edgeScore,
          minutesStabilityIndex: getStability(s.playerName).stabilityIndex,
          foulRisk: 'low' as const,
          paceMult,
        };
      });
  }, [enrichedSpots, fatigueData, homeTeam, getPlayerRegression, getStability, paceMult, pbpData?.pace, mcResults]);

  // Run MC simulations when mode is ON
  useEffect(() => {
    if (!useMonteCarloMode || propCards.length === 0) return;

    const runAll = async () => {
      const results = new Map<string, number>();
      await Promise.all(
        propCards.map(async (p) => {
          const sigmaRem = Math.max(1, (p.projectedFinal - p.currentValue) * 0.3);
          const pOver = await runSimulation({
            id: p.id,
            projected: p.projectedFinal,
            sigmaRem,
            line: p.line,
            currentValue: p.currentValue,
          });
          results.set(p.id, pOver);
        })
      );
      setMcResults(results);
    };

    runAll();
  }, [useMonteCarloMode, enrichedSpots, runSimulation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build hedge opportunities for slide-in
  const hedgeOpportunities: HedgeOpportunity[] = useMemo(() => {
    return propCards
      .filter((p) => p.hasHedgeOpportunity)
      .map((p) => {
        // Determine side from projection vs live line
        const side = p.projectedFinal >= p.liveBookLine ? 'OVER' : 'UNDER';

        // Smart line picker: find the best line across all books for the recommended side
        let smartLine = p.liveBookLine;
        let smartBookmaker: string | undefined;

        if (p.allBookLines && p.allBookLines.length > 0) {
          if (side === 'OVER') {
            // For OVER: pick the LOWEST line (easiest to clear)
            const best = p.allBookLines.reduce((a, b) => a.line < b.line ? a : b);
            smartLine = best.line;
            smartBookmaker = best.bookmaker;
          } else {
            // For UNDER: pick the HIGHEST line (most room underneath)
            const best = p.allBookLines.reduce((a, b) => a.line > b.line ? a : b);
            smartLine = best.line;
            smartBookmaker = best.bookmaker;
          }
        }

        const suggestedAction = `BET ${side} ${smartLine}`;
        return {
          id: p.id,
          playerName: p.playerName,
          propType: p.propType,
          liveProjection: p.projectedFinal,
          liveLine: smartLine,
          edge: p.projectedFinal - smartLine,
          kellySuggestion: Math.min(15, Math.max(1, Math.abs(p.projectedFinal - smartLine) / smartLine * 50)),
          evPercent: ((p.projectedFinal - smartLine) / smartLine) * 100,
          side,
          suggestedAction,
          smartBookmaker,
        };
      });
  }, [propCards]);

  // Advanced metrics
  const currentGame = games.find(
    (g) => g.status === 'in_progress'
  );
  const scoreDiff = currentGame
    ? Math.abs(currentGame.homeScore - currentGame.awayScore)
    : 0;
  const blowoutRisk = Math.min(100, scoreDiff * 3);
  const avgFatigue = propCards.length > 0
    ? propCards.reduce((s, p) => s + p.fatiguePercent, 0) / propCards.length
    : 0;

  return (
    <div className="warroom min-h-screen space-y-3 p-1">
      {/* Demo Banner */}
      {isDemo && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--warroom-green)/0.08)] border border-[hsl(var(--warroom-green)/0.2)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--warroom-green))] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[hsl(var(--warroom-green))]" />
          </span>
          <span className="text-xs text-[hsl(var(--warroom-green))] font-medium">
            Preview Mode — Live data appears when a game starts
          </span>
        </div>
      )}

      {/* Game Strip — derived from props data */}
      {onGameChange && (
        <WarRoomGameStrip
          activeEventId={gameContext.eventId}
          adminEventId={adminEventId}
          propsGames={availableGames}
          onSelectGame={onGameChange}
        />
      )}

      {/* Mode Toggle */}
      <div className="flex items-center gap-1 p-1 rounded-lg warroom-card w-fit">
        <button
          onClick={() => setViewMode('game')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            viewMode === 'game'
              ? 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))]'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Gamepad2 className="w-3.5 h-3.5" />
          Game Mode
        </button>
        <button
          onClick={() => setViewMode('hedge')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            viewMode === 'hedge'
              ? 'bg-[hsl(var(--warroom-gold)/0.15)] text-[hsl(var(--warroom-gold))]'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Hedge Mode
        </button>
      </div>

      {/* Hero — Live Game Panel */}
      <AnimatePresence mode="wait">
        <motion.div
          key={gameContext.eventId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <CustomerLiveGamePanel
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            eventId={gameContext.eventId}
            espnEventId={gameContext.espnEventId}
          />
        </motion.div>
      </AnimatePresence>

      {/* Props Section */}
      <AnimatePresence mode="wait">
        {viewMode === 'game' ? (
          <motion.div
            key="game-mode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-2"
          >
            {propCards.length > 0 ? (
              propCards.map((p) => <WarRoomPropCard key={p.id} data={p} />)
            ) : (
              <div className="warroom-card p-6 text-center text-sm text-muted-foreground col-span-full">
                No props found for this game. Select a game with available player props.
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="hedge-mode"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <HedgeModeTable props={propCards} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confidence Dashboard — hidden in Hedge Mode (table has survival %) */}
      {viewMode !== 'hedge' && <CustomerConfidenceDashboard picks={confidencePicks} />}

      {/* AI Commentary Whisper */}
      <CustomerAIWhisper picks={whisperPicks} signals={effectiveSignals} />

      {/* Advanced Metrics */}
      <AdvancedMetricsPanel
        blowoutRiskPct={blowoutRisk}
        fatigueImpactPct={avgFatigue}
        regressionAlerts={regressionAlerts}
        useMonteCarloMode={useMonteCarloMode}
        onMonteCarloToggle={setUseMonteCarloMode}
      />

      {/* Hedge Slide-In Alerts */}
      <HedgeSlideIn opportunities={hedgeOpportunities} />
    </div>
  );
}
