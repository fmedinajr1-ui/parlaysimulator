import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

interface EnginePick {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence?: number;
  engine: string;
  decision?: string;
  ses_score?: number;
}

interface ComparisonRow {
  player_name: string;
  prop_type: string;
  line: number;
  riskEngine: EnginePick | null;
  propV2: EnginePick | null;
  sharpBuilder: EnginePick | null;
  heatEngine: EnginePick | null;
  consensus: 'unanimous' | 'majority' | 'split' | 'single';
  agreementScore: number;
}

export function useEngineComparison() {
  const today = getEasternDate();

  return useQuery({
    queryKey: ['engine-comparison', today],
    queryFn: async () => {
      // Fetch from all engines in parallel
      const [riskResult, propV2Result, sharpResult, heatResult] = await Promise.all([
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
          .eq('parlay_date', today) as any
      ]);

      const riskPicks: EnginePick[] = (riskResult.data || []).map((p: any) => ({
        player_name: p.player_name,
        prop_type: p.prop_type,
        line: p.line,
        side: p.side || 'over',
        confidence: p.confidence_score,
        engine: 'risk',
        decision: p.recommendation
      }));

      const propV2Picks: EnginePick[] = (propV2Result.data || []).map((p: any) => ({
        player_name: p.player_name,
        prop_type: p.prop_type,
        line: p.line,
        side: p.side || 'over',
        confidence: p.ses_score,
        engine: 'propv2',
        decision: p.decision,
        ses_score: p.ses_score
      }));

      // Extract legs from sharp parlays
      const sharpPicks: EnginePick[] = [];
      for (const parlay of sharpResult.data || []) {
        for (const legKey of ['leg_1', 'leg_2']) {
          const leg = parlay[legKey];
          if (leg && typeof leg === 'object') {
            sharpPicks.push({
              player_name: leg.player_name || '',
              prop_type: leg.prop_type || leg.stat_type || '',
              line: leg.line || 0,
              side: leg.side || 'over',
              engine: 'sharp',
              decision: parlay.parlay_type
            });
          }
        }
      }

      // Extract legs from heat parlays
      const heatPicks: EnginePick[] = [];
      for (const parlay of heatResult.data || []) {
        const legs = parlay.legs;
        if (Array.isArray(legs)) {
          for (const leg of legs) {
            if (leg && typeof leg === 'object') {
              heatPicks.push({
                player_name: leg.player_name || '',
                prop_type: leg.prop_type || leg.stat_type || '',
                line: leg.line || 0,
                side: leg.side || 'over',
                engine: 'heat',
                decision: parlay.parlay_type
              });
            }
          }
        }
      }

      // Build comparison map
      const comparisonMap = new Map<string, ComparisonRow>();

      const addToMap = (pick: EnginePick, engineKey: 'riskEngine' | 'propV2' | 'sharpBuilder' | 'heatEngine') => {
        const key = `${pick.player_name}|${pick.prop_type}`.toLowerCase();
        if (!comparisonMap.has(key)) {
          comparisonMap.set(key, {
            player_name: pick.player_name,
            prop_type: pick.prop_type,
            line: pick.line,
            riskEngine: null,
            propV2: null,
            sharpBuilder: null,
            heatEngine: null,
            consensus: 'single',
            agreementScore: 0
          });
        }
        const row = comparisonMap.get(key)!;
        row[engineKey] = pick;
        if (pick.line > 0) row.line = pick.line; // Use non-zero line
      };

      riskPicks.forEach(p => addToMap(p, 'riskEngine'));
      propV2Picks.forEach(p => addToMap(p, 'propV2'));
      sharpPicks.forEach(p => addToMap(p, 'sharpBuilder'));
      heatPicks.forEach(p => addToMap(p, 'heatEngine'));

      // Calculate consensus and agreement scores
      const rows = Array.from(comparisonMap.values()).map(row => {
        const engines = [row.riskEngine, row.propV2, row.sharpBuilder, row.heatEngine].filter(Boolean);
        const engineCount = engines.length;
        
        // Calculate agreement (same side)
        const sides = engines.map(e => e?.side?.toLowerCase());
        const overCount = sides.filter(s => s === 'over').length;
        const underCount = sides.filter(s => s === 'under').length;
        
        if (engineCount === 1) {
          row.consensus = 'single';
          row.agreementScore = 25;
        } else if (overCount === engineCount || underCount === engineCount) {
          row.consensus = engineCount >= 3 ? 'unanimous' : 'majority';
          row.agreementScore = engineCount * 25;
        } else if (Math.max(overCount, underCount) > engineCount / 2) {
          row.consensus = 'majority';
          row.agreementScore = Math.max(overCount, underCount) * 25;
        } else {
          row.consensus = 'split';
          row.agreementScore = 25;
        }
        
        return row;
      });

      // Sort by agreement score (highest first), then by engine count
      rows.sort((a, b) => {
        const aEngines = [a.riskEngine, a.propV2, a.sharpBuilder, a.heatEngine].filter(Boolean).length;
        const bEngines = [b.riskEngine, b.propV2, b.sharpBuilder, b.heatEngine].filter(Boolean).length;
        if (b.agreementScore !== a.agreementScore) return b.agreementScore - a.agreementScore;
        return bEngines - aEngines;
      });

      // Calculate stats
      const multiEngineRows = rows.filter(r => 
        [r.riskEngine, r.propV2, r.sharpBuilder, r.heatEngine].filter(Boolean).length >= 2
      );
      const unanimousCount = rows.filter(r => r.consensus === 'unanimous').length;
      const splitCount = rows.filter(r => r.consensus === 'split').length;

      return {
        rows,
        stats: {
          totalProps: rows.length,
          multiEngine: multiEngineRows.length,
          unanimous: unanimousCount,
          split: splitCount,
          avgAgreement: rows.length > 0 
            ? rows.reduce((sum, r) => sum + r.agreementScore, 0) / rows.length 
            : 0
        }
      };
    },
    staleTime: 30000,
  });
}
