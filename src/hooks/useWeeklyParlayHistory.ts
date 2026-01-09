import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subDays, format } from "date-fns";

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
  streak: { type: 'W' | 'L' | null; count: number };
}

type ParlayOutcome = 'won' | 'lost' | 'push' | 'pending';

interface SharpParlay {
  parlay_date: string;
  parlay_type: string;
  outcome: string;
}

interface HeatParlay {
  parlay_date: string;
  parlay_type: string;
  outcome: string;
}

export function useWeeklyParlayHistory() {
  return useQuery({
    queryKey: ['weekly-parlay-history'],
    queryFn: async (): Promise<WeeklyStats> => {
      const today = new Date();
      const sevenDaysAgo = subDays(today, 6);
      
      const startDate = format(sevenDaysAgo, 'yyyy-MM-dd');
      const endDate = format(today, 'yyyy-MM-dd');

      // Fetch both tables in parallel
      const [sharpResult, heatResult] = await Promise.all([
        supabase
          .from('sharp_ai_parlays')
          .select('parlay_date, parlay_type, outcome')
          .gte('parlay_date', startDate)
          .lte('parlay_date', endDate)
          .order('parlay_date', { ascending: false }),
        supabase
          .from('heat_parlays')
          .select('parlay_date, parlay_type, outcome')
          .gte('parlay_date', startDate)
          .lte('parlay_date', endDate)
          .order('parlay_date', { ascending: false })
      ]);

      if (sharpResult.error) throw sharpResult.error;
      if (heatResult.error) throw heatResult.error;

      const sharpParlays = (sharpResult.data || []) as SharpParlay[];
      const heatParlays = (heatResult.data || []) as HeatParlay[];

      // Build daily records
      const dailyRecords: DailyRecord[] = [];
      
      for (let i = 0; i < 7; i++) {
        const date = format(subDays(today, i), 'yyyy-MM-dd');
        
        const daySharp = sharpParlays.filter(p => p.parlay_date === date);
        const dayHeat = heatParlays.filter(p => p.parlay_date === date);

        const getOutcome = (parlays: { parlay_type: string; outcome: string }[], type: string): ParlayOutcome | null => {
          const parlay = parlays.find(p => p.parlay_type?.toUpperCase() === type.toUpperCase());
          if (!parlay) return null;
          return (parlay.outcome as ParlayOutcome) || 'pending';
        };

        const allOutcomes = [
          ...daySharp.map(p => p.outcome || 'pending'),
          ...dayHeat.map(p => p.outcome || 'pending')
        ];

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
          }
        });
      }

      // Calculate overall stats
      const allSharpOutcomes = sharpParlays.map(p => p.outcome || 'pending');
      const allHeatOutcomes = heatParlays.map(p => p.outcome || 'pending');
      const allOutcomes = [...allSharpOutcomes, ...allHeatOutcomes];

      const calculateStats = (outcomes: string[]): SystemStats => {
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
      const settledOutcomes: string[] = [];
      
      for (const record of dailyRecords) {
        const dayOutcomes = [
          record.sharpParlays.safe,
          record.sharpParlays.balanced,
          record.sharpParlays.upside,
          record.heatParlays.core,
          record.heatParlays.upside,
        ].filter(o => o === 'won' || o === 'lost') as string[];
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
        streak,
      };
    },
    refetchInterval: 60000,
  });
}
