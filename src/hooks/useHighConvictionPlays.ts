import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

/** Strip sport prefixes so player_points → points, batter_hits → hits, etc. */
function normalizePropType(raw: string): string {
  return raw
    .replace(/^(player_|batter_|pitcher_)/, '')
    .toLowerCase()
    .trim();
}

interface MispricedLine {
  player_name: string;
  prop_type: string;
  signal: string;
  edge_pct: number;
  confidence_tier: string;
  current_line: number;
  player_avg: number;
  sport: string;
}

interface EnginePick {
  player_name: string;
  prop_type: string;
  side: string;
  confidence?: number;
  engine: string;
}

export interface HighConvictionPlay {
  player_name: string;
  prop_type: string;
  displayPropType: string;
  signal: string;
  edge_pct: number;
  confidence_tier: string;
  current_line: number;
  player_avg: number;
  sport: string;
  engines: { engine: string; side: string; confidence?: number }[];
  sideAgreement: boolean;
  convictionScore: number;
}

export function useHighConvictionPlays() {
  const today = getEasternDate();

  return useQuery({
    queryKey: ['high-conviction-plays', today],
    queryFn: async (): Promise<{ plays: HighConvictionPlay[]; stats: { total: number; allAgree: number; engineCounts: Record<string, number> } }> => {
      // Fetch mispriced lines + all engine picks in parallel
      const [mispricedResult, riskResult, propV2Result, sharpResult, heatResult] = await Promise.all([
        supabase
          .from('mispriced_lines')
          .select('player_name, prop_type, signal, edge_pct, confidence_tier, current_line, player_avg, sport')
          .eq('analysis_date', today) as any,
        supabase
          .from('nba_risk_engine_picks')
          .select('player_name, prop_type, line, side, confidence_score, recommendation')
          .eq('game_date', today) as any,
        supabase
          .from('prop_engine_v2_picks')
          .select('player_name, prop_type, line, side, ses_score, decision')
          .eq('game_date', today) as any,
        supabase
          .from('sharp_ai_parlays')
          .select('leg_1, leg_2, parlay_type')
          .eq('parlay_date', today) as any,
        supabase
          .from('heat_parlays')
          .select('legs, parlay_type')
          .eq('parlay_date', today) as any,
      ]);

      const mispricedLines: MispricedLine[] = mispricedResult.data || [];

      // Build engine picks map keyed by normalized "player|prop"
      const engineMap = new Map<string, EnginePick[]>();

      const addPick = (pick: EnginePick) => {
        const key = `${pick.player_name.toLowerCase()}|${normalizePropType(pick.prop_type)}`;
        if (!engineMap.has(key)) engineMap.set(key, []);
        engineMap.get(key)!.push(pick);
      };

      // Risk engine
      for (const p of riskResult.data || []) {
        addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.confidence_score, engine: 'risk' });
      }

      // Prop V2
      for (const p of propV2Result.data || []) {
        addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.ses_score, engine: 'propv2' });
      }

      // Sharp parlays — extract legs
      for (const parlay of sharpResult.data || []) {
        for (const legKey of ['leg_1', 'leg_2']) {
          const leg = parlay[legKey];
          if (leg && typeof leg === 'object') {
            addPick({ player_name: leg.player_name || '', prop_type: leg.prop_type || leg.stat_type || '', side: leg.side || 'over', engine: 'sharp' });
          }
        }
      }

      // Heat parlays — extract legs
      for (const parlay of heatResult.data || []) {
        if (Array.isArray(parlay.legs)) {
          for (const leg of parlay.legs) {
            if (leg && typeof leg === 'object') {
              addPick({ player_name: leg.player_name || '', prop_type: leg.prop_type || leg.stat_type || '', side: leg.side || 'over', engine: 'heat' });
            }
          }
        }
      }

      // Cross-reference
      const plays: HighConvictionPlay[] = [];

      for (const ml of mispricedLines) {
        const key = `${ml.player_name.toLowerCase()}|${normalizePropType(ml.prop_type)}`;
        const matches = engineMap.get(key);
        if (!matches || matches.length === 0) continue;

        const mispricedSide = ml.signal.toLowerCase();
        const sideAgreement = matches.every(m => m.side.toLowerCase() === mispricedSide);

        // Conviction score
        const edgeScore = Math.min(Math.abs(ml.edge_pct) / 10, 10); // 0-10
        const tierBonus = ml.confidence_tier === 'ELITE' ? 3 : ml.confidence_tier === 'HIGH' ? 2 : 1;
        const engineCountBonus = matches.length * 2;
        const agreementBonus = sideAgreement ? 3 : 0;
        const sameDirectionEngines = matches.filter(m => m.side.toLowerCase() === mispricedSide).length;
        const directionBonus = sameDirectionEngines * 1.5;
        const riskConfidence = matches.find(m => m.engine === 'risk')?.confidence || 0;
        const riskBonus = riskConfidence > 0 ? riskConfidence / 20 : 0;

        const convictionScore = edgeScore + tierBonus + engineCountBonus + agreementBonus + directionBonus + riskBonus;

        plays.push({
          player_name: ml.player_name,
          prop_type: normalizePropType(ml.prop_type),
          displayPropType: ml.prop_type,
          signal: ml.signal,
          edge_pct: ml.edge_pct,
          confidence_tier: ml.confidence_tier,
          current_line: ml.current_line,
          player_avg: ml.player_avg,
          sport: ml.sport,
          engines: matches.map(m => ({ engine: m.engine, side: m.side, confidence: m.confidence })),
          sideAgreement,
          convictionScore,
        });
      }

      plays.sort((a, b) => b.convictionScore - a.convictionScore);

      const engineCounts: Record<string, number> = {};
      for (const p of plays) {
        for (const e of p.engines) {
          engineCounts[e.engine] = (engineCounts[e.engine] || 0) + 1;
        }
      }

      return {
        plays,
        stats: {
          total: plays.length,
          allAgree: plays.filter(p => p.sideAgreement).length,
          engineCounts,
        },
      };
    },
    staleTime: 30000,
  });
}
