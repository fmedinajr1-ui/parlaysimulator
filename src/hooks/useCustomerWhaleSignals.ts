import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type SignalType = 'STEAM' | 'FREEZE' | 'DIVERGENCE';

export interface WhaleSignalEntry {
  signalType: SignalType;
  sharpScore: number;
}

function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function useCustomerWhaleSignals() {
  const today = getEasternDate();

  return useQuery({
    queryKey: ['customer-whale-signals', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whale_signals')
        .select('market_key, signal_type, sharp_score')
        .gte('created_at', `${today}T00:00:00`)
        .lt('created_at', `${today}T23:59:59`);

      if (error) throw error;

      // Build a map keyed by lowercased player name extracted from market_key
      // market_key format is typically "player_name|prop_type" or similar
      const signalMap = new Map<string, WhaleSignalEntry>();
      for (const row of data ?? []) {
        // Extract player name from market_key (take first segment before any delimiter)
        const playerName = row.market_key
          .split(/[|_]/)[0]
          ?.trim()
          ?.toLowerCase();
        if (playerName && !signalMap.has(playerName)) {
          signalMap.set(playerName, {
            signalType: row.signal_type as SignalType,
            sharpScore: row.sharp_score,
          });
        }
      }
      return signalMap;
    },
    staleTime: 60_000,
  });
}
