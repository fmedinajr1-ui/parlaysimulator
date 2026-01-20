import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format } from "date-fns";
import { useEffect } from "react";
import type { Json } from "@/integrations/supabase/types";

export interface LegData {
  player: string;
  prop: string;
  line: number;
  side: 'over' | 'under' | string;
  outcome?: 'hit' | 'miss' | 'push' | 'won' | 'lost' | 'pending' | null;
  actual_value?: number | null;
}

export interface ParlayRecord {
  id: string;
  date: string;
  system: 'sharp' | 'heat';
  type: string;
  outcome: 'won' | 'lost' | 'push' | 'pending';
  legs: LegData[];
  total_odds?: number;
}

interface DailyRecord {
  date: string;
  sharpParlays: {
    safe: 'won' | 'lost' | 'push' | 'pending' | null;
    balanced: 'won' | 'lost' | 'push' | 'pending' | null;
    upside: 'won' | 'lost' | 'push' | 'pending' | null;
  };
  heatParlays: {
    core: 'won' | 'lost' | 'push' | 'pending' | null;
    upside: 'won' | 'lost' | 'push' | 'pending' | null;
  };
  totals: {
    won: number;
    lost: number;
    push: number;
    pending: number;
  };
  parlays: ParlayRecord[];
}

interface SystemStats {
  won: number;
  lost: number;
  push: number;
  pending: number;
  winRate: number;
}

interface WeeklyStats {
  overall: {
    won: number;
    lost: number;
    push: number;
    pending: number;
    winRate: number;
  };
  bySystem: {
    sharp: SystemStats;
    heat: SystemStats;
  };
  dailyRecords: DailyRecord[];
  allParlays: ParlayRecord[];
  streak: { type: 'W' | 'L' | null; count: number };
}

type ParlayOutcome = 'won' | 'lost' | 'push' | 'pending';

interface SharpParlayRow {
  id: string;
  parlay_date: string;
  parlay_type: string;
  outcome: string | null;
  legs: Json;
  total_odds: number | null;
}

interface HeatParlayRow {
  id: string;
  parlay_date: string;
  parlay_type: string;
  outcome: string | null;
  leg_1: Json;
  leg_2: Json;
  estimated_odds: number | null;
}

// Normalize outcome values from different formats (hit/miss, won/lost, partial)
export function normalizeOutcome(outcome: string | null | undefined): ParlayOutcome {
  if (!outcome) return 'pending';
  const normalized = outcome.toLowerCase().trim();
  
  // Map hit/miss to won/lost
  if (normalized === 'hit' || normalized === 'won') return 'won';
  if (normalized === 'miss' || normalized === 'lost') return 'lost';
  if (normalized === 'push') return 'push';
  
  // Partial means still in progress
  if (normalized === 'partial') return 'pending';
  
  return 'pending';
}

// Parse leg data from JSON
function parseLegData(legJson: Json | null): LegData | null {
  if (!legJson || typeof legJson !== 'object' || Array.isArray(legJson)) return null;
  const leg = legJson as Record<string, unknown>;
  
  const rawOutcome = leg.outcome ? String(leg.outcome).toLowerCase().trim() : null;
  const validOutcomes = ['hit', 'miss', 'push', 'won', 'lost', 'pending'] as const;
  const outcome = rawOutcome && validOutcomes.includes(rawOutcome as typeof validOutcomes[number]) 
    ? rawOutcome as LegData['outcome']
    : null;
  
  return {
    player: String(leg.player_name || leg.player || ''),
    prop: String(leg.prop_type || leg.prop || ''),
    line: Number(leg.line) || 0,
    side: String(leg.side || 'over'),
    outcome,
    actual_value: leg.actual_value != null ? Number(leg.actual_value) : null,
  };
}

// Parse legs array from JSON
function parseLegsArray(legsJson: Json | null): LegData[] {
  if (!legsJson) return [];
  if (Array.isArray(legsJson)) {
    return legsJson.map(parseLegData).filter((l): l is LegData => l !== null);
  }
  return [];
}

export function useWeeklyParlayHistory() {
  const queryClient = useQueryClient();
  
  // Set up realtime subscription for parlay updates
  useEffect(() => {
    const channel = supabase
      .channel('weekly-parlay-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sharp_ai_parlays' },
        () => {
          console.log('[weekly-history] Sharp parlay updated, refetching...');
          queryClient.invalidateQueries({ queryKey: ['weekly-parlay-history'] });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'heat_parlays' },
        () => {
          console.log('[weekly-history] Heat parlay updated, refetching...');
          queryClient.invalidateQueries({ queryKey: ['weekly-parlay-history'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['weekly-parlay-history'],
    queryFn: async (): Promise<WeeklyStats> => {
      const today = new Date();
      const sevenDaysAgo = subDays(today, 6);
      
      const startDate = format(sevenDaysAgo, 'yyyy-MM-dd');
      const endDate = format(today, 'yyyy-MM-dd');

      // Fetch both tables in parallel with full leg data
      const [sharpResult, heatResult] = await Promise.all([
        supabase
          .from('sharp_ai_parlays')
          .select('id, parlay_date, parlay_type, outcome, legs, total_odds')
          .gte('parlay_date', startDate)
          .lte('parlay_date', endDate)
          .order('parlay_date', { ascending: false }),
        supabase
          .from('heat_parlays')
          .select('id, parlay_date, parlay_type, outcome, leg_1, leg_2, estimated_odds')
          .gte('parlay_date', startDate)
          .lte('parlay_date', endDate)
          .order('parlay_date', { ascending: false })
      ]);

      if (sharpResult.error) throw sharpResult.error;
      if (heatResult.error) throw heatResult.error;

      const sharpRows = (sharpResult.data || []) as SharpParlayRow[];
      const heatRows = (heatResult.data || []) as HeatParlayRow[];

      // Convert to unified ParlayRecord format
      const sharpParlayRecords: ParlayRecord[] = sharpRows.map(row => ({
        id: row.id,
        date: row.parlay_date,
        system: 'sharp' as const,
        type: row.parlay_type || 'UNKNOWN',
        outcome: normalizeOutcome(row.outcome),
        legs: parseLegsArray(row.legs),
        total_odds: row.total_odds ?? undefined,
      }));

      const heatParlayRecords: ParlayRecord[] = heatRows.map(row => {
        const legs: LegData[] = [];
        const leg1 = parseLegData(row.leg_1);
        const leg2 = parseLegData(row.leg_2);
        if (leg1) legs.push(leg1);
        if (leg2) legs.push(leg2);
        
        return {
          id: row.id,
          date: row.parlay_date,
          system: 'heat' as const,
          type: row.parlay_type || 'UNKNOWN',
          outcome: normalizeOutcome(row.outcome),
          legs,
          total_odds: row.estimated_odds ?? undefined,
        };
      });

      const allParlays = [...sharpParlayRecords, ...heatParlayRecords];

      // Build daily records
      const dailyRecords: DailyRecord[] = [];
      
      for (let i = 0; i < 7; i++) {
        const date = format(subDays(today, i), 'yyyy-MM-dd');
        
        const daySharp = sharpParlayRecords.filter(p => p.date === date);
        const dayHeat = heatParlayRecords.filter(p => p.date === date);
        const dayParlays = [...daySharp, ...dayHeat];

        const getOutcome = (parlays: ParlayRecord[], type: string): ParlayOutcome | null => {
          const parlay = parlays.find(p => p.type?.toUpperCase() === type.toUpperCase());
          return parlay?.outcome ?? null;
        };

        // Aggregate outcomes
        const allOutcomes = dayParlays.map(p => p.outcome);

        dailyRecords.push({
          date,
          sharpParlays: {
            safe: getOutcome(daySharp, 'SAFE'),
            balanced: getOutcome(daySharp, 'BALANCED'),
            upside: getOutcome(daySharp, 'UPSIDE'),
          },
          heatParlays: {
            core: getOutcome(dayHeat, 'CORE'),
            upside: getOutcome(dayHeat, 'UPSIDE'),
          },
          totals: {
            won: allOutcomes.filter(o => o === 'won').length,
            lost: allOutcomes.filter(o => o === 'lost').length,
            push: allOutcomes.filter(o => o === 'push').length,
            pending: allOutcomes.filter(o => o === 'pending').length,
          },
          parlays: dayParlays,
        });
      }

      // Calculate overall stats
      const allSharpOutcomes = sharpParlayRecords.map(p => p.outcome);
      const allHeatOutcomes = heatParlayRecords.map(p => p.outcome);
      const allOutcomes = [...allSharpOutcomes, ...allHeatOutcomes];

      const calculateStats = (outcomes: ParlayOutcome[]): SystemStats => {
        const won = outcomes.filter(o => o === 'won').length;
        const lost = outcomes.filter(o => o === 'lost').length;
        const push = outcomes.filter(o => o === 'push').length;
        const pending = outcomes.filter(o => o === 'pending').length;
        const settled = won + lost;
        return {
          won,
          lost,
          push,
          pending,
          winRate: settled > 0 ? (won / settled) * 100 : 0
        };
      };

      const overallStats = calculateStats(allOutcomes);
      const sharpStats = calculateStats(allSharpOutcomes);
      const heatStats = calculateStats(allHeatOutcomes);

      // Calculate streak (from most recent settled)
      let streak: { type: 'W' | 'L' | null; count: number } = { type: null, count: 0 };
      const settledOutcomes: ParlayOutcome[] = [];
      
      for (const record of dailyRecords) {
        const dayOutcomes = [
          record.sharpParlays.safe,
          record.sharpParlays.balanced,
          record.sharpParlays.upside,
          record.heatParlays.core,
          record.heatParlays.upside,
        ].filter((o): o is 'won' | 'lost' => o === 'won' || o === 'lost');
        settledOutcomes.push(...dayOutcomes);
      }

      if (settledOutcomes.length > 0) {
        const firstResult = settledOutcomes[0];
        streak.type = firstResult === 'won' ? 'W' : 'L';
        streak.count = 1;
        
        for (let i = 1; i < settledOutcomes.length; i++) {
          if (settledOutcomes[i] === firstResult) {
            streak.count++;
          } else {
            break;
          }
        }
      }

      return {
        overall: overallStats,
        bySystem: {
          sharp: sharpStats,
          heat: heatStats,
        },
        dailyRecords,
        allParlays,
        streak,
      };
    },
    refetchInterval: 30000, // Refetch every 30 seconds for more responsive updates
  });
}
